import type { FastifyPluginAsync } from 'fastify';
import {
  acceptInviteSchema,
  createInviteSchema,
  updateMemberSchema,
  type InviteInfoResponse,
  type StaffResponse,
} from '@peciatka/shared';
import { config } from '../../config.js';
import { audit } from '../../lib/audit.js';
import { hashPassword, randomToken, sha256 } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { mailTemplates, type Mailer } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { createSession, requireTenant } from '../../plugins/auth.js';
import { buildMe } from '../auth/routes.js';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

/** /api/staff — управление командой (только владелец). */
export const staffRoutes: FastifyPluginAsync<{ mailer: Mailer }> = async (app, { mailer }) => {
  const ownerOnly = { preHandler: requireTenant('OWNER') };

  app.get('/', ownerOnly, async (req): Promise<StaffResponse> => {
    const { salonId } = req.tenant!;
    const [members, invites] = await Promise.all([
      prisma.membership.findMany({
        where: { salonId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.invite.findMany({
        where: { salonId, acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      members: members.map((m) => ({
        membershipId: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        active: m.active,
        isMe: m.user.id === req.auth!.user.id,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
      })),
    };
  });

  app.post('/invites', ownerOnly, async (req, reply) => {
    const { salonId } = req.tenant!;
    const input = parse(createInviteSchema, req.body);

    const existing = await prisma.membership.findFirst({
      where: { salonId, active: true, user: { email: input.email } },
    });
    if (existing) throw conflict('already_member');

    const token = randomToken();
    const salon = await prisma.salon.findUniqueOrThrow({ where: { id: salonId } });
    const invite = await prisma.$transaction(async (tx) => {
      // предыдущие приглашения на тот же email больше не нужны
      await tx.invite.deleteMany({ where: { salonId, email: input.email, acceptedAt: null } });
      const invite = await tx.invite.create({
        data: {
          salonId,
          email: input.email,
          role: input.role,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      await audit(tx, {
        salonId,
        actorUserId: req.auth!.user.id,
        action: 'staff.invite',
        entityType: 'invite',
        entityId: invite.id,
        payload: { email: input.email, role: input.role },
      });
      return invite;
    });

    const url = `${config.APP_URL}/invite/${token}`;
    await mailer.send({
      to: input.email,
      ...mailTemplates.invite(salon.defaultLocale, { salonName: salon.name, url }),
    });

    // Ссылку отдаём и владельцу: её можно переслать мастеру в WhatsApp/Viber.
    return reply.code(201).send({ id: invite.id, url });
  });

  app.delete<{ Params: { id: string } }>('/invites/:id', ownerOnly, async (req, reply) => {
    const { salonId } = req.tenant!;
    const { count } = await prisma.invite.deleteMany({ where: { id: req.params.id, salonId } });
    if (count === 0) throw notFound();
    return reply.code(204).send();
  });

  app.patch<{ Params: { id: string } }>('/members/:id', ownerOnly, async (req) => {
    const { salonId } = req.tenant!;
    const input = parse(updateMemberSchema, req.body);

    const member = await prisma.membership.findFirst({ where: { id: req.params.id, salonId } });
    if (!member) throw notFound();
    // Себя менять нельзя: так салон не останется без владельца.
    if (member.userId === req.auth!.user.id) throw badRequest('cannot_modify_self');

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.membership.update({ where: { id: member.id }, data: input });
      await audit(tx, {
        salonId,
        actorUserId: req.auth!.user.id,
        action: 'staff.update',
        entityType: 'membership',
        entityId: member.id,
        payload: input,
      });
      return updated;
    });
    return { membershipId: updated.id, role: updated.role, active: updated.active };
  });
};

/** /api/invites — принятие приглашения (публичное, по токену). */
export const inviteRoutes: FastifyPluginAsync = async (app) => {
  const strictLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  async function findValidInvite(token: string) {
    const invite = await prisma.invite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { salon: { select: { id: true, name: true } } },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
      throw notFound('invite_invalid');
    }
    return invite;
  }

  app.get<{ Params: { token: string } }>('/:token', { config: strictLimit }, async (req): Promise<InviteInfoResponse> => {
    const invite = await findValidInvite(req.params.token);
    const user = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    return { salonName: invite.salon.name, email: invite.email, role: invite.role, userExists: !!user };
  });

  app.post<{ Params: { token: string } }>('/:token/accept', { config: strictLimit }, async (req, reply) => {
    const invite = await findValidInvite(req.params.token);
    const input = parse(acceptInviteSchema, req.body);

    let userId: string;
    if (req.auth) {
      // уже вошёл: приглашение должно быть на его email
      if (req.auth.user.email !== invite.email) throw new AppError(403, 'invite_email_mismatch');
      userId = req.auth.user.id;
    } else {
      const existing = await prisma.user.findUnique({ where: { email: invite.email } });
      if (existing) throw conflict('login_required');
      if (!input.name || !input.password) throw badRequest('name_password_required');
      const user = await prisma.user.create({
        data: { email: invite.email, name: input.name, passwordHash: await hashPassword(input.password) },
      });
      userId = user.id;
    }

    await prisma.$transaction(async (tx) => {
      const membership = await tx.membership.upsert({
        where: { userId_salonId: { userId, salonId: invite.salonId } },
        create: { userId, salonId: invite.salonId, role: invite.role },
        update: { role: invite.role, active: true },
      });
      await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      await audit(tx, {
        salonId: invite.salonId,
        actorUserId: userId,
        action: 'staff.join',
        entityType: 'membership',
        entityId: membership.id,
        payload: { role: invite.role },
      });
    });

    if (req.auth) {
      await prisma.session.update({ where: { id: req.auth.sessionId }, data: { salonId: invite.salonId } });
    } else {
      await createSession(prisma, reply, userId, invite.salonId);
    }
    return buildMe(userId, invite.salonId);
  });
};
