import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma.js';
import type { MemoryMailer } from '../src/lib/mailer.js';
import { addStaff, createTestApp, json, resetDb, salonWithProgram } from './helpers.js';

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
});

const client = { name: 'Lucia', phone: '0905 777 888', consent: true, locale: 'sk' };

describe('first stamp on sign-up', () => {
  it('self sign-up by the poster gives the first stamp from the system', async () => {
    const { slug } = await salonWithProgram(app, { firstStampOnJoin: true });
    const res = await app.inject({ method: 'POST', url: `/api/public/salons/${slug}/join`, payload: client });
    const card = await prisma.card.findUniqueOrThrow({ where: { serialNumber: json(res).serial } });
    expect(card).toMatchObject({ stampCount: 1, totalVisits: 1 });
    const event = await prisma.stampEvent.findFirstOrThrow({ where: { cardId: card.id } });
    expect(event.actorUserId).toBeNull();
    // карта с первым штампом видна клиентке
    const pub = json(await app.inject({ method: 'GET', url: `/api/public/cards/${card.serialNumber}` }));
    expect(pub.stampCount).toBe(1);
  });

  it('signing up again with the same phone does not give another stamp', async () => {
    const { slug } = await salonWithProgram(app, { firstStampOnJoin: true });
    await app.inject({ method: 'POST', url: `/api/public/salons/${slug}/join`, payload: client });
    await app.inject({ method: 'POST', url: `/api/public/salons/${slug}/join`, payload: { ...client, phone: '+421905777888' } });
    expect(await prisma.stampEvent.count()).toBe(1);
  });

  it('can be switched off in the program', async () => {
    const { slug } = await salonWithProgram(app, { firstStampOnJoin: false });
    const res = await app.inject({ method: 'POST', url: `/api/public/salons/${slug}/join`, payload: client });
    const card = await prisma.card.findUniqueOrThrow({ where: { serialNumber: json(res).serial } });
    expect(card.stampCount).toBe(0);
  });

  it('saving the program without the field keeps the current setting', async () => {
    const { owner } = await salonWithProgram(app, { firstStampOnJoin: false });
    const { firstStampOnJoin: _omit, ...rest } = (await prisma.loyaltyProgram.findFirstOrThrow()) as any;
    await owner.client.put('/api/program', {
      name: rest.name, stampsRequired: rest.stampsRequired, rewardText: rest.rewardText, cooldownHours: rest.cooldownHours,
      bgColor: rest.bgColor, fgColor: rest.fgColor, labelColor: rest.labelColor,
    });
    expect((await prisma.loyaltyProgram.findFirstOrThrow()).firstStampOnJoin).toBe(false);
  });
});

describe('sign-up at the counter', () => {
  it('staff registers a client: card + first stamp, logged as a counter sign-up by that staff member', async () => {
    const { owner } = await salonWithProgram(app, { firstStampOnJoin: true });
    const staff = await addStaff(app, owner.client, mailer);

    const res = await staff.client.post('/api/cards/register', client);
    expect(res.statusCode).toBe(201);
    const body = json(res);
    expect(body).toMatchObject({ created: true, firstStamp: true });

    const card = json(await staff.client.get(`/api/cards/${body.cardId}`));
    expect(card).toMatchObject({ customer: { name: 'Lucia', phone: '+421905777888' }, stampCount: 1 });
    // это и есть сегодняшний визит — второй штамп не пройдёт по лимиту
    expect(card.nextStampAllowedAt).not.toBeNull();

    const event = await prisma.stampEvent.findFirstOrThrow({ where: { cardId: body.cardId } });
    expect(event.actorUserId).toBe(staff.me.user.id);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'customer.join' } });
    expect(log).toMatchObject({ actorUserId: staff.me.user.id, payload: { source: 'counter' } });
  });

  it('existing client is not duplicated and gets no extra stamp', async () => {
    const { owner, slug } = await salonWithProgram(app, { firstStampOnJoin: true });
    await app.inject({ method: 'POST', url: `/api/public/salons/${slug}/join`, payload: client });

    const res = await owner.client.post('/api/cards/register', { ...client, name: 'Lucia N.' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ created: false, firstStamp: false });
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.stampEvent.count()).toBe(1);
  });

  it('validates input like the public form (consent, contact, phone)', async () => {
    const { owner } = await salonWithProgram(app);
    expect(json(await owner.client.post('/api/cards/register', { ...client, consent: false })).error.code).toBe('validation');
    expect(json(await owner.client.post('/api/cards/register', { ...client, phone: '12' })).error.code).toBe('phone_invalid');
  });

  it('requires a logged-in member of the salon', async () => {
    await salonWithProgram(app);
    const res = await app.inject({ method: 'POST', url: '/api/cards/register', payload: client });
    expect(res.statusCode).toBe(401);
  });

  it('shows a QR with the link to the client card; other salons get 404', async () => {
    const a = await salonWithProgram(app, {}, 'Salon A');
    const b = await salonWithProgram(app, {}, 'Salon B');
    const { cardId } = json(await a.owner.client.post('/api/cards/register', client));

    const qr = await a.owner.client.get(`/api/cards/${cardId}/wallet-qr.svg`);
    expect(qr.headers['content-type']).toBe('image/svg+xml');
    expect(qr.body).toContain('<svg');
    expect((await b.owner.client.get(`/api/cards/${cardId}/wallet-qr.svg`)).statusCode).toBe(404);
  });
});
