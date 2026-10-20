import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma.js';
import type { MemoryMailer } from '../src/lib/mailer.js';
import { createTestApp, json, registerOwner, resetDb, TestClient } from './helpers.js';

let app: FastifyInstance;
let mailer: MemoryMailer;

beforeAll(async () => {
  ({ app, mailer } = await createTestApp());
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  mailer.outbox = [];
});

describe('registration', () => {
  it('creates user, salon, OWNER membership and logs in', async () => {
    const { client, me } = await registerOwner(app, 'Nechtové štúdio Žaneta');
    expect(me.salons).toHaveLength(1);
    expect(me.salons[0].role).toBe('OWNER');
    expect(me.currentSalonId).toBe(me.salons[0].id);

    const salon = await prisma.salon.findUniqueOrThrow({ where: { id: me.currentSalonId } });
    expect(salon.slug).toBe('nechtove-studio-zaneta');
    expect(salon.timezone).toBe('Europe/Bratislava');

    const meRes = await client.get('/api/auth/me');
    expect(meRes.statusCode).toBe(200);

    const log = await prisma.auditLog.findFirst({ where: { salonId: salon.id, action: 'salon.create' } });
    expect(log).not.toBeNull();
  });

  it('generates unique slug for duplicate salon names', async () => {
    const a = await registerOwner(app, 'Barber');
    const b = await registerOwner(app, 'Barber');
    const slugs = await prisma.salon.findMany({
      where: { id: { in: [a.me.currentSalonId, b.me.currentSalonId] } },
      select: { slug: true },
    });
    expect(new Set(slugs.map((s) => s.slug)).size).toBe(2);
  });

  it('rejects duplicate email (case-insensitive)', async () => {
    const { email } = await registerOwner(app);
    const res = await new TestClient(app).post('/api/auth/register', {
      salonName: 'Other',
      name: 'X',
      email: email.toUpperCase(),
      password: 'password123',
    });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe('email_taken');
  });

  it('validates input with i18n message keys', async () => {
    const res = await new TestClient(app).post('/api/auth/register', {
      salonName: 'S',
      name: '',
      email: 'not-email',
      password: '123',
    });
    expect(res.statusCode).toBe(400);
    const messages = json(res).error.issues.map((i: { message: string }) => i.message);
    expect(messages).toEqual(expect.arrayContaining(['v.email', 'v.password_min', 'v.required']));
  });
});

describe('login / logout', () => {
  it('logs in with correct password and rejects wrong one', async () => {
    const { email } = await registerOwner(app);
    const c = new TestClient(app);

    const bad = await c.post('/api/auth/login', { email, password: 'wrong-password' });
    expect(bad.statusCode).toBe(401);
    expect(json(bad).error.code).toBe('invalid_credentials');

    const unknown = await c.post('/api/auth/login', { email: 'nobody@test.sk', password: 'password123' });
    expect(unknown.statusCode).toBe(401);

    const ok = await c.post('/api/auth/login', { email, password: 'password123' });
    expect(ok.statusCode).toBe(200);
    expect(json(ok).currentSalonId).toBeTruthy();
  });

  it('logout invalidates the session', async () => {
    const { client } = await registerOwner(app);
    expect((await client.post('/api/auth/logout')).statusCode).toBe(204);
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('expired session is rejected', async () => {
    const { client } = await registerOwner(app);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
  });
});

describe('password reset', () => {
  it('sends link, resets password once, kills old sessions', async () => {
    const { client, email } = await registerOwner(app);
    const anon = new TestClient(app);

    expect((await anon.post('/api/auth/forgot-password', { email })).statusCode).toBe(204);
    expect(mailer.outbox).toHaveLength(1);
    const token = mailer.outbox[0]!.text.match(/token=([\w-]+)/)![1]!;

    const reset = await anon.post('/api/auth/reset-password', { token, password: 'newpassword1' });
    expect(reset.statusCode).toBe(204);

    // старая сессия больше не действует
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
    // токен одноразовый
    const again = await anon.post('/api/auth/reset-password', { token, password: 'another-pass' });
    expect(json(again).error.code).toBe('token_invalid');

    const login = await anon.post('/api/auth/login', { email, password: 'newpassword1' });
    expect(login.statusCode).toBe(200);
  });

  it('does not reveal unknown emails', async () => {
    const res = await new TestClient(app).post('/api/auth/forgot-password', { email: 'nobody@test.sk' });
    expect(res.statusCode).toBe(204);
    expect(mailer.outbox).toHaveLength(0);
  });
});
