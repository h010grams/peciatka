import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma.js';
import type { MemoryMailer } from '../src/lib/mailer.js';
import { periodRange } from '../src/modules/stats/routes.js';
import { addStaff, createTestApp, joinCustomer, json, resetDb, salonWithProgram } from './helpers.js';

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

describe('customer list', () => {
  it('lists, searches by name and by phone digits; staff can search', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const staff = await addStaff(app, owner.client, mailer);
    await joinCustomer(app, slug, { name: 'Jana Nováková', phone: '0905 111 222' });
    await joinCustomer(app, slug, { name: 'Petra Kováčová', phone: '0910 333 444', email: 'petra@test.sk' });

    const all = json(await owner.client.get('/api/customers'));
    expect(all.total).toBe(2);

    const byName = json(await staff.client.get('/api/customers?q=nov'));
    expect(byName.items.map((c: any) => c.name)).toEqual(['Jana Nováková']);

    const byPhone = json(await staff.client.get(`/api/customers?q=${encodeURIComponent('0910 333')}`));
    expect(byPhone.items.map((c: any) => c.name)).toEqual(['Petra Kováčová']);

    const byEmail = json(await staff.client.get('/api/customers?q=petra@'));
    expect(byEmail.total).toBe(1);

    // спецсимволы LIKE не ломают поиск
    expect(json(await owner.client.get('/api/customers?q=%25')).total).toBe(0);
  });

  it('detail shows history with who did what', async () => {
    const { owner, slug } = await salonWithProgram(app, { stampsRequired: 2, cooldownHours: 0 });
    const { cardId } = await joinCustomer(app, slug);
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await owner.client.post(`/api/cards/${cardId}/rewards/redeem`);
    const customer = await prisma.customer.findFirstOrThrow();

    const detail = json(await owner.client.get(`/api/customers/${customer.id}`));
    expect(detail.totalVisits).toBe(2);
    const types = detail.history.map((h: any) => h.type);
    expect(types.filter((t: string) => t === 'STAMP')).toHaveLength(2);
    expect(types).toContain('REWARD_EARNED');
    expect(types).toContain('REWARD_REDEEMED');
    expect(detail.history.find((h: any) => h.type === 'REWARD_REDEEMED').actorName).toBe(owner.me.user.name);
  });

  it('other salon cannot see the customer', async () => {
    const a = await salonWithProgram(app, {}, 'Salon A');
    const b = await salonWithProgram(app, {}, 'Salon B');
    await joinCustomer(app, b.slug);
    const customer = await prisma.customer.findFirstOrThrow();
    expect(json(await a.owner.client.get('/api/customers')).total).toBe(0);
    expect((await a.owner.client.get(`/api/customers/${customer.id}`)).statusCode).toBe(404);
    expect((await a.owner.client.delete(`/api/customers/${customer.id}`)).statusCode).toBe(404);
  });
});

describe('GDPR', () => {
  it('owner exports all customer data as JSON; staff cannot', async () => {
    const { owner, slug } = await salonWithProgram(app, { cooldownHours: 0 });
    const staff = await addStaff(app, owner.client, mailer);
    const { cardId } = await joinCustomer(app, slug, { name: 'Jana', email: 'jana@test.sk' });
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    const customer = await prisma.customer.findFirstOrThrow();

    expect((await staff.client.get(`/api/customers/${customer.id}/export`)).statusCode).toBe(403);
    const res = await owner.client.get(`/api/customers/${customer.id}/export`);
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = json(res);
    expect(data.customer).toMatchObject({ name: 'Jana', email: 'jana@test.sk' });
    expect(data.customer.consent.textVersion).toBe('2026-10-v1');
    expect(data.cards[0].stamps).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'customer.export' } })).toBe(1);
  });

  it('delete anonymizes personal data, voids the card, keeps statistics', async () => {
    const { owner, slug } = await salonWithProgram(app, { cooldownHours: 0 });
    const { cardId, serial } = await joinCustomer(app, slug, { name: 'Jana', email: 'jana@test.sk' });
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    const visitsBefore = json(await owner.client.get('/api/stats?period=7d')).visits;
    const customer = await prisma.customer.findFirstOrThrow();
    await prisma.walletSyncJob.deleteMany();

    expect((await owner.client.delete(`/api/customers/${customer.id}`)).statusCode).toBe(204);

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after).toMatchObject({ name: '—', phoneE164: null, email: null });
    expect(after.anonymizedAt).not.toBeNull();
    expect((await prisma.card.findUniqueOrThrow({ where: { id: cardId } })).status).toBe('VOIDED');
    // Wallet получит аннулированную карту
    expect(await prisma.walletSyncJob.count({ where: { cardId } })).toBe(1);
    // карта больше не открывается и не сканируется
    expect((await app.inject({ method: 'GET', url: `/api/public/cards/${serial}` })).statusCode).toBe(404);
    expect((await owner.client.post(`/api/cards/${cardId}/stamps`)).statusCode).toBe(404);
    // в списке её нет, а визиты в статистике остались
    expect(json(await owner.client.get('/api/customers')).total).toBe(0);
    expect(json(await owner.client.get('/api/stats?period=7d')).visits).toBe(visitsBefore);
    // журнал без персональных данных
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'customer.delete' } });
    expect(JSON.stringify(log)).not.toContain('jana');
  });

  it('the same phone can register again after deletion', async () => {
    const { owner, slug } = await salonWithProgram(app);
    await joinCustomer(app, slug, { phone: '0905999888' });
    const c = await prisma.customer.findFirstOrThrow();
    await owner.client.delete(`/api/customers/${c.id}`);
    const again = await joinCustomer(app, slug, { phone: '0905999888' });
    expect(again.serial).toBeTruthy();
    expect(await prisma.customer.count({ where: { anonymizedAt: null } })).toBe(1);
  });
});

describe('statistics', () => {
  it('counts new customers, visits, returning customers and rewards; ignores revoked stamps', async () => {
    const { owner, slug } = await salonWithProgram(app, { stampsRequired: 2, cooldownHours: 0 });
    const a = await joinCustomer(app, slug, { name: 'A' });
    const b = await joinCustomer(app, slug, { name: 'B' });
    const c = await joinCustomer(app, slug, { name: 'C' });

    // A: два визита (вернулась) + награда + погашение
    await owner.client.post(`/api/cards/${a.cardId}/stamps`);
    await owner.client.post(`/api/cards/${a.cardId}/stamps`);
    await owner.client.post(`/api/cards/${a.cardId}/rewards/redeem`);
    // B: один визит
    await owner.client.post(`/api/cards/${b.cardId}/stamps`);
    // C: ошибочный штамп, отменён
    await owner.client.post(`/api/cards/${c.cardId}/stamps`);
    await owner.client.post(`/api/cards/${c.cardId}/stamps/revoke-last`);

    const stats = json(await owner.client.get('/api/stats?period=30d'));
    expect(stats).toMatchObject({
      period: '30d',
      newCustomers: 3,
      totalCustomers: 3,
      visits: 3,
      activeCustomers: 2,
      returningCustomers: 1,
      rewardsEarned: 1,
      rewardsRedeemed: 1,
    });
    expect(stats.daily).toHaveLength(30);
    expect(stats.daily.at(-1).visits).toBe(3);
  });

  it('stats and audit log are owner-only', async () => {
    const { owner } = await salonWithProgram(app);
    const staff = await addStaff(app, owner.client, mailer);
    expect((await staff.client.get('/api/stats')).statusCode).toBe(403);
    expect((await staff.client.get('/api/audit')).statusCode).toBe(403);
    const audit = json(await owner.client.get('/api/audit'));
    expect(audit.items.map((i: any) => i.action)).toEqual(
      expect.arrayContaining(['salon.create', 'program.create', 'staff.invite', 'staff.join']),
    );
  });

  it('period starts at local midnight in Bratislava', () => {
    // 7. 10. 2026 01:30 в Братиславе = 6. 10. 23:30 UTC (летнее время, UTC+2)
    const now = new Date('2026-10-06T23:30:00Z');
    const { from, days } = periodRange('7d', 'Europe/Bratislava', now);
    expect(days.at(-1)).toBe('2026-10-07');
    expect(days[0]).toBe('2026-10-01');
    expect(from.toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });
});
