import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import type { Role, User } from '@prisma/client';
import { config } from '../config.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { prisma, type Tx } from '../lib/prisma.js';

export const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const SESSION_RENEW_MS = 15 * 24 * 3600 * 1000;

export interface AuthContext {
  sessionId: string;
  salonId: string | null;
  user: Pick<User, 'id' | 'email' | 'name' | 'locale'>;
}

export interface TenantContext {
  salonId: string;
  role: Role;
  membershipId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    tenant: TenantContext | null;
  }
}

// ───────── Сессии ─────────

export async function createSession(
  db: Tx,
  reply: FastifyReply,
  userId: string,
  salonId: string | null,
) {
  const token = randomToken();
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      salonId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  setSessionCookie(reply, token);
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax', // блокирует CSRF через кросс-сайтовые POST
    secure: config.cookieSecure,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Первый активный салон пользователя — его выбираем после входа. */
export async function defaultSalonId(db: Tx, userId: string): Promise<string | null> {
  const m = await db.membership.findFirst({
    where: { userId, active: true },
    orderBy: { createdAt: 'asc' },
    select: { salonId: true },
  });
  return m?.salonId ?? null;
}

// ───────── Guards ─────────

export const requireAuth: preHandlerAsyncHookHandler = async (req) => {
  if (!req.auth) throw unauthorized();
};

/**
 * Пускает только активных участников выбранного салона (и только с нужной ролью).
 * Дальше хендлер берёт salonId ИСКЛЮЧИТЕЛЬНО из req.tenant, а не из запроса.
 */
export function requireTenant(...roles: Role[]): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest) => {
    if (!req.auth) throw unauthorized();
    if (!req.auth.salonId) throw forbidden();
    const membership = await prisma.membership.findUnique({
      where: { userId_salonId: { userId: req.auth.user.id, salonId: req.auth.salonId } },
    });
    if (!membership || !membership.active) throw forbidden();
    if (roles.length > 0 && !roles.includes(membership.role)) throw forbidden();
    req.tenant = { salonId: membership.salonId, role: membership.role, membershipId: membership.id };
  };
}

// ───────── Plugin ─────────

export const authPlugin = fp(async (app) => {
  app.decorateRequest('auth', null);
  app.decorateRequest('tenant', null);

  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;

    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, email: true, name: true, locale: true } } },
    });
    if (!session) return;

    if (session.expiresAt.getTime() < Date.now()) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      clearSessionCookie(reply);
      return;
    }

    // Скользящее продление: активные пользователи не разлогиниваются.
    if (session.expiresAt.getTime() - Date.now() < SESSION_RENEW_MS) {
      await prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      });
      setSessionCookie(reply, token);
    }

    req.auth = { sessionId: session.id, salonId: session.salonId, user: session.user };
  });
});
