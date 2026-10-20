import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  switchSalonSchema,
  updateMeSchema,
  type MeResponse,
} from '@peciatka/shared';
import { config } from '../../config.js';
import { audit } from '../../lib/audit.js';
import { getDummyHash, hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, forbidden } from '../../lib/errors.js';
import { mailTemplates, type Mailer } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { slugify, slugWithSuffix } from '../../lib/slug.js';
import { parse } from '../../lib/validate.js';
import { clearSessionCookie, createSession, defaultSalonId, requireAuth } from '../../plugins/auth.js';

const RESET_TTL_MS = 3600 * 1000;
// Жёсткий лимит для эндпоинтов, по которым подбирают пароли.
const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export async function buildMe(userId: string, currentSalonId: string | null): Promise<MeResponse> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      memberships: {
        where: { active: true },
        include: { salon: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  return {
    user: { id: user.id, name: user.name, email: user.email, locale: user.locale },
    salons: user.memberships.map((m) => ({ id: m.salon.id, name: m.salon.name, role: m.role })),
    currentSalonId,
  };
}

export const authRoutes: FastifyPluginAsync<{ mailer: Mailer }> = async (app, { mailer }) => {
  // Регистрация владельца вместе с салоном.
  app.post('/register', { config: strictLimit }, async (req, reply) => {
    const input = parse(registerSchema, req.body);
    const passwordHash = await hashPassword(input.password);

    const result = await prisma
      .$transaction(async (tx) => {
        const base = slugify(input.salonName);
        const taken = await tx.salon.findUnique({ where: { slug: base }, select: { id: true } });
        const slug = taken ? slugWithSuffix(base) : base;

        const user = await tx.user.create({
          data: { email: input.email, passwordHash, name: input.name, locale: input.locale },
        });
        const salon = await tx.salon.create({
          data: { name: input.salonName, slug, defaultLocale: input.locale },
        });
        await tx.membership.create({ data: { userId: user.id, salonId: salon.id, role: 'OWNER' } });
        await audit(tx, {
          salonId: salon.id,
          actorUserId: user.id,
          action: 'salon.create',
          entityType: 'salon',
          entityId: salon.id,
          payload: { name: salon.name },
        });
        await createSession(tx, reply, user.id, salon.id);
        return { userId: user.id, salonId: salon.id };
      })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw conflict('email_taken');
        }
        throw e;
      });

    return reply.code(201).send(await buildMe(result.userId, result.salonId));
  });

  app.post('/login', { config: strictLimit }, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const ok = user
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyPassword(await getDummyHash(), input.password).then(() => false);
    if (!user || !ok) throw new AppError(401, 'invalid_credentials');

    const salonId = await defaultSalonId(prisma, user.id);
    await createSession(prisma, reply, user.id, salonId);
    return buildMe(user.id, salonId);
  });

  app.post('/logout', async (req, reply) => {
    if (req.auth) await prisma.session.delete({ where: { id: req.auth.sessionId } }).catch(() => {});
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    return buildMe(req.auth!.user.id, req.auth!.salonId);
  });

  app.patch('/me', { preHandler: requireAuth }, async (req) => {
    const input = parse(updateMeSchema, req.body);
    await prisma.user.update({ where: { id: req.auth!.user.id }, data: input });
    return buildMe(req.auth!.user.id, req.auth!.salonId);
  });

  app.post('/switch-salon', { preHandler: requireAuth }, async (req) => {
    const { salonId } = parse(switchSalonSchema, req.body);
    const m = await prisma.membership.findUnique({
      where: { userId_salonId: { userId: req.auth!.user.id, salonId } },
    });
    if (!m || !m.active) throw forbidden();
    await prisma.session.update({ where: { id: req.auth!.sessionId }, data: { salonId } });
    return buildMe(req.auth!.user.id, salonId);
  });

  // Всегда 204, чтобы нельзя было проверить, зарегистрирован ли email.
  app.post('/forgot-password', { config: strictLimit }, async (req, reply) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = randomToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });
      const url = `${config.APP_URL}/reset-password?token=${token}`;
      await mailer.send({ to: user.email, ...mailTemplates.passwordReset(user.locale, { url }) });
    }
    return reply.code(204).send();
  });

  app.post('/reset-password', { config: strictLimit }, async (req, reply) => {
    const input = parse(resetPasswordSchema, req.body);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw badRequest('token_invalid');
    }
    const passwordHash = await hashPassword(input.password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // разлогиниваем все устройства: возможно, пароль украли
      prisma.session.deleteMany({ where: { userId: record.userId } }),
    ]);
    return reply.code(204).send();
  });
};
