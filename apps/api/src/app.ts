import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { DomainError } from './domain/stamping.js';
import { AppError } from './lib/errors.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { prisma } from './lib/prisma.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { salonRoutes } from './modules/salons/routes.js';
import { inviteRoutes, staffRoutes } from './modules/staff/routes.js';
import { programRoutes } from './modules/program/routes.js';
import { publicRoutes } from './modules/public/routes.js';
import { posterRoutes } from './modules/poster/routes.js';
import { cardRoutes } from './modules/cards/routes.js';
import { customerRoutes } from './modules/customers/routes.js';
import { statsRoutes } from './modules/stats/routes.js';
import { appleWebServiceRoutes } from './modules/wallet/apple-ws.js';

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
  mailer?: Mailer;
  rateLimit?: boolean;
  webDistDir?: string;
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true, // за прокси Railway/Render — правильный IP для rate-limit
  });
  const mailer = opts.mailer ?? createMailer();

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  // Лимиты заданы точечно в config.rateLimit маршрутов; в тестах плагин отключаем.
  if (opts.rateLimit !== false) await app.register(rateLimit, { global: false });
  await app.register(authPlugin);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, ...err.details } });
    }
    // нарушение бизнес-правила (лимит штампов, нет награды…) → 409
    if (err instanceof DomainError) {
      return reply.code(409).send({ error: { code: err.code, ...err.details } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'validation',
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: { code: 'rate_limited' } });
    if (status === 413) return reply.code(413).send({ error: { code: 'file_too_large' } });
    if (status && status < 500) return reply.code(status).send({ error: { code: 'bad_request' } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal' } });
  });

  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: '/api/auth', mailer });
  await app.register(salonRoutes, { prefix: '/api/salon' });
  await app.register(staffRoutes, { prefix: '/api/staff', mailer });
  await app.register(inviteRoutes, { prefix: '/api/invites' });
  await app.register(programRoutes, { prefix: '/api/program' });
  await app.register(posterRoutes, { prefix: '/api/poster' });
  await app.register(cardRoutes, { prefix: '/api/cards' });
  await app.register(customerRoutes, { prefix: '/api/customers' });
  await app.register(statsRoutes, { prefix: '/api' });
  await app.register(publicRoutes, { prefix: '/api/public' });
  await app.register(appleWebServiceRoutes, { prefix: '/api/wallet/apple' });

  // Продакшен: тот же сервер отдаёт собранный фронт (SPA).
  const webDist =
    opts.webDistDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: { code: 'not_found' } });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found' } }));
  }

  return app;
}
