import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma.js';
import type { MemoryMailer } from '../src/lib/mailer.js';
import { processReminders } from '../src/jobs/reminders.js';
import { addStamp, revokeLastStamp } from '../src/services/cards.js';
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

/** Сдвигаем время последнего штампа в прошлое, чтобы обойти лимит без ожидания. */
async function rewindStamps(cardId: string, hours: number) {
  const shift = `${hours} hours`;
  await prisma.$executeRaw`UPDATE "StampEvent" SET "createdAt" = "createdAt" - ${shift}::interval WHERE "cardId" = ${cardId}::uuid`;
  await prisma.$executeRaw`UPDATE "Card" SET "lastStampAt" = "lastStampAt" - ${shift}::interval WHERE id = ${cardId}::uuid`;
}

describe('scanning', () => {
  it('staff finds card by QR token and sees customer name', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const staff = await addStaff(app, owner.client, mailer);
    const { qrToken, cardId } = await joinCustomer(app, slug, { name: 'Jana Nováková' });

    const res = await staff.client.get(`/api/cards/by-qr/${qrToken}`);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({
      id: cardId,
      customer: { name: 'Jana Nováková' },
      stampCount: 0,
      stampsRequired: 5,
      nextStampAllowedAt: null,
      revocable: null,
    });
  });

  it('card of another salon looks like it does not exist', async () => {
    const a = await salonWithProgram(app, {}, 'Salon A');
    const b = await salonWithProgram(app, {}, 'Salon B');
    const { qrToken, cardId } = await joinCustomer(app, b.slug);

    expect((await a.owner.client.get(`/api/cards/by-qr/${qrToken}`)).statusCode).toBe(404);
    expect((await a.owner.client.get(`/api/cards/${cardId}`)).statusCode).toBe(404);
    expect((await a.owner.client.post(`/api/cards/${cardId}/stamps`)).statusCode).toBe(404);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.stampCount).toBe(0);
  });

  it('garbage ids and tokens are 404, not 500', async () => {
    const { owner } = await salonWithProgram(app);
    expect((await owner.client.get('/api/cards/not-a-uuid')).statusCode).toBe(404);
    expect((await owner.client.get('/api/cards/by-qr/%27%3B--')).statusCode).toBe(404);
  });
});

describe('stamping', () => {
  it('adds a stamp, writes audit log, queues wallet sync with notification', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { cardId } = await joinCustomer(app, slug, { locale: 'uk' });

    const res = await owner.client.post(`/api/cards/${cardId}/stamps`);
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.rewardEarned).toBe(false);
    expect(body.card.stampCount).toBe(1);
    expect(body.card.totalVisits).toBe(1);
    expect(body.card.nextStampAllowedAt).not.toBeNull();
    expect(body.card.revocable).not.toBeNull();

    expect(await prisma.auditLog.count({ where: { action: 'stamp.add', entityId: cardId } })).toBe(1);
    const job = await prisma.walletSyncJob.findUniqueOrThrow({ where: { cardId } });
    expect(job.notify).toBe('Новий штамп: 1 з 5. Дякуємо за візит!'); // язык клиентки
  });

  it('cooldown blocks a second stamp and tells when it is allowed', async () => {
    const { owner, slug } = await salonWithProgram(app, { cooldownHours: 12 });
    const { cardId } = await joinCustomer(app, slug);

    await owner.client.post(`/api/cards/${cardId}/stamps`);
    const second = await owner.client.post(`/api/cards/${cardId}/stamps`);
    expect(second.statusCode).toBe(409);
    const err = json(second).error;
    expect(err.code).toBe('cooldown');
    const retryInHours = (Date.parse(err.retryAt) - Date.now()) / 3600_000;
    expect(retryInHours).toBeGreaterThan(11.9);
    expect(retryInHours).toBeLessThanOrEqual(12);

    await rewindStamps(cardId, 13);
    expect((await owner.client.post(`/api/cards/${cardId}/stamps`)).statusCode).toBe(200);
  });

  it('cooldown 0 allows several stamps in a row', async () => {
    const { owner, slug } = await salonWithProgram(app, { cooldownHours: 0 });
    const { cardId } = await joinCustomer(app, slug);
    for (let i = 0; i < 3; i++) expect((await owner.client.post(`/api/cards/${cardId}/stamps`)).statusCode).toBe(200);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: cardId } })).stampCount).toBe(3);
  });

  it('concurrent scans of the same card give exactly one stamp', async () => {
    const { owner, slug } = await salonWithProgram(app, { cooldownHours: 12 });
    const staff = await addStaff(app, owner.client, mailer);
    const { cardId } = await joinCustomer(app, slug);

    const results = await Promise.all([
      owner.client.post(`/api/cards/${cardId}/stamps`),
      staff.client.post(`/api/cards/${cardId}/stamps`),
      owner.client.post(`/api/cards/${cardId}/stamps`),
      staff.client.post(`/api/cards/${cardId}/stamps`),
    ]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(3);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.stampCount).toBe(1);
    expect(await prisma.stampEvent.count({ where: { cardId } })).toBe(1);
  });
});

describe('rewards', () => {
  it('N-th stamp earns a reward, counter restarts, redeem uses it once', async () => {
    const { owner, slug } = await salonWithProgram(app, { stampsRequired: 3, cooldownHours: 0 });
    const { cardId } = await joinCustomer(app, slug);

    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    const third = json(await owner.client.post(`/api/cards/${cardId}/stamps`));
    expect(third.rewardEarned).toBe(true);
    expect(third.card).toMatchObject({ stampCount: 0, rewardsAvailable: 1, totalVisits: 3 });
    const job = await prisma.walletSyncJob.findUniqueOrThrow({ where: { cardId } });
    expect(job.notify).toContain('Máte odmenu: Zľava 15 %');

    const redeem = await owner.client.post(`/api/cards/${cardId}/rewards/redeem`);
    expect(redeem.statusCode).toBe(200);
    expect(json(redeem).card.rewardsAvailable).toBe(0);
    const reward = await prisma.reward.findFirstOrThrow({ where: { cardId } });
    expect(reward.status).toBe('REDEEMED');
    expect(reward.redeemedByUserId).toBe(owner.me.user.id);

    const again = await owner.client.post(`/api/cards/${cardId}/rewards/redeem`);
    expect(again.statusCode).toBe(409);
    expect(json(again).error.code).toBe('no_reward');
  });

  it('rewards accumulate if not redeemed', async () => {
    const { owner, slug } = await salonWithProgram(app, { stampsRequired: 2, cooldownHours: 0 });
    const { cardId } = await joinCustomer(app, slug);
    for (let i = 0; i < 5; i++) await owner.client.post(`/api/cards/${cardId}/stamps`);
    const card = json(await owner.client.get(`/api/cards/${cardId}`));
    expect(card).toMatchObject({ stampCount: 1, rewardsAvailable: 2, totalVisits: 5 });
  });
});

describe('revoking a mistaken stamp', () => {
  it('removes the last stamp and reopens the cooldown', async () => {
    const { owner, slug } = await salonWithProgram(app, { cooldownHours: 12 });
    const { cardId } = await joinCustomer(app, slug);
    await owner.client.post(`/api/cards/${cardId}/stamps`);

    const res = await owner.client.post(`/api/cards/${cardId}/stamps/revoke-last`);
    expect(res.statusCode).toBe(200);
    expect(json(res).card).toMatchObject({ stampCount: 0, totalVisits: 0, nextStampAllowedAt: null, revocable: null });
    expect(await prisma.auditLog.count({ where: { action: 'stamp.revoke' } })).toBe(1);

    // штамп можно поставить заново сразу
    expect((await owner.client.post(`/api/cards/${cardId}/stamps`)).statusCode).toBe(200);
  });

  it('revoking the reward-earning stamp voids the reward', async () => {
    const { owner, slug } = await salonWithProgram(app, { stampsRequired: 2, cooldownHours: 0 });
    const { cardId } = await joinCustomer(app, slug);
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await owner.client.post(`/api/cards/${cardId}/stamps`); // награда

    const res = json(await owner.client.post(`/api/cards/${cardId}/stamps/revoke-last`));
    expect(res.card).toMatchObject({ stampCount: 1, rewardsAvailable: 0, totalVisits: 1 });
    expect((await prisma.reward.findFirstOrThrow({ where: { cardId } })).status).toBe('VOID');
  });

  it('cannot revoke a stamp whose reward was already redeemed', async () => {
    const { owner, slug } = await salonWithProgram(app, { stampsRequired: 2, cooldownHours: 0 });
    const { cardId } = await joinCustomer(app, slug);
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await owner.client.post(`/api/cards/${cardId}/rewards/redeem`);

    expect(json(await owner.client.get(`/api/cards/${cardId}`)).revocable).toBeNull();
    const res = await owner.client.post(`/api/cards/${cardId}/stamps/revoke-last`);
    expect(json(res).error.code).toBe('reward_already_redeemed');
  });

  it('cannot revoke after 24 hours', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { cardId } = await joinCustomer(app, slug);
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await rewindStamps(cardId, 25);
    const res = await owner.client.post(`/api/cards/${cardId}/stamps/revoke-last`);
    expect(json(res).error.code).toBe('revoke_expired');
  });

  it('nothing to revoke on a fresh card', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { cardId } = await joinCustomer(app, slug);
    const res = await owner.client.post(`/api/cards/${cardId}/stamps/revoke-last`);
    expect(json(res).error.code).toBe('nothing_to_revoke');
  });

  it('two stamps in the same millisecond: undo removes the latest one, not a random one', async () => {
    const { owner, slug, salonId } = await salonWithProgram(app, { stampsRequired: 2, cooldownHours: 0 });
    const { cardId } = await joinCustomer(app, slug);
    const now = new Date();
    await addStamp(salonId, cardId, owner.me.user.id, now);
    await addStamp(salonId, cardId, owner.me.user.id, now); // этот штамп дал награду
    await revokeLastStamp(salonId, cardId, owner.me.user.id, now);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    expect(card).toMatchObject({ stampCount: 1, rewardsAvailable: 0 });
    expect((await prisma.reward.findFirstOrThrow({ where: { cardId } })).status).toBe('VOID');
  });

  it('revoking twice removes two different stamps', async () => {
    const { owner, slug } = await salonWithProgram(app, { cooldownHours: 0 });
    const { cardId } = await joinCustomer(app, slug);
    for (let i = 0; i < 3; i++) await owner.client.post(`/api/cards/${cardId}/stamps`);
    await owner.client.post(`/api/cards/${cardId}/stamps/revoke-last`);
    const res = json(await owner.client.post(`/api/cards/${cardId}/stamps/revoke-last`));
    expect(res.card.stampCount).toBe(1);
    expect(await prisma.stampEvent.count({ where: { cardId, type: 'REVOKE' } })).toBe(2);
  });
});

describe('next appointment and reminders', () => {
  function localIn(hours: number) {
    // местное время Bratislava, формат datetime-local
    const d = new Date(Date.now() + hours * 3600_000);
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Bratislava',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .format(d)
      .replace(' ', 'T');
  }

  it('stores salon-local time as UTC and shows it on the card', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { cardId } = await joinCustomer(app, slug);
    const local = localIn(72);
    const res = await owner.client.put(`/api/cards/${cardId}/appointment`, { startsAt: local });
    expect(res.statusCode).toBe(200);
    const at = new Date(json(res).card.nextAppointmentAt);
    // обратное преобразование в Bratislava даёт то же время
    const back = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Bratislava',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(at).replace(' ', 'T');
    expect(back).toBe(local);

    // новая запись заменяет старую
    await owner.client.put(`/api/cards/${cardId}/appointment`, { startsAt: localIn(96) });
    expect(await prisma.appointment.count({ where: { cardId, cancelledAt: null } })).toBe(1);

    const del = await owner.client.delete(`/api/cards/${cardId}/appointment`);
    expect(json(del).card.nextAppointmentAt).toBeNull();
  });

  it('rejects past dates', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { cardId } = await joinCustomer(app, slug);
    const res = await owner.client.put(`/api/cards/${cardId}/appointment`, { startsAt: localIn(-2) });
    expect(json(res).error.code).toBe('appointment_invalid');
  });

  it('sends one reminder a day before; skips appointments booked less than a day ahead', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const early = await joinCustomer(app, slug, { name: 'Early' });
    const late = await joinCustomer(app, slug, { name: 'Late' });

    await owner.client.put(`/api/cards/${early.cardId}/appointment`, { startsAt: localIn(20) });
    await owner.client.put(`/api/cards/${late.cardId}/appointment`, { startsAt: localIn(20) });
    // первую запись «создали» три дня назад
    await prisma.appointment.updateMany({
      where: { cardId: early.cardId },
      data: { createdAt: new Date(Date.now() - 72 * 3600_000) },
    });
    await prisma.walletSyncJob.deleteMany();

    expect(await processReminders()).toBe(1);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: early.cardId } });
    expect(card.walletNotice).toMatch(/^Pripomíname termín v salóne Salón Test: /);
    expect(await prisma.walletSyncJob.count({ where: { cardId: early.cardId } })).toBe(1);
    expect(await prisma.walletSyncJob.count({ where: { cardId: late.cardId } })).toBe(0);

    // повторный запуск ничего не шлёт
    expect(await processReminders()).toBe(0);
  });
});
