import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { prisma } from '../src/lib/prisma.js';
import type { MemoryMailer } from '../src/lib/mailer.js';
import { addStaff, createTestApp, DEFAULT_PROGRAM, joinCustomer, json, registerOwner, resetDb, salonWithProgram } from './helpers.js';

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

function multipart(filename: string, content: Buffer, mime: string) {
  const boundary = '----test' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('loyalty program', () => {
  it('owner creates and updates the program; staff can read but not edit', async () => {
    const owner = await registerOwner(app);
    expect(json(await owner.client.get('/api/program')).program).toBeNull();

    const created = await owner.client.put('/api/program', DEFAULT_PROGRAM);
    expect(created.statusCode).toBe(200);
    expect(json(created).program).toMatchObject({ stampsRequired: 5, rewardText: 'Zľava 15 %', logoUrl: null });

    const staff = await addStaff(app, owner.client, mailer);
    expect(json(await staff.client.get('/api/program')).program.name).toBe('Vernostná karta');
    expect((await staff.client.put('/api/program', DEFAULT_PROGRAM)).statusCode).toBe(403);
  });

  it('validates ranges and colors', async () => {
    const owner = await registerOwner(app);
    const res = await owner.client.put('/api/program', { ...DEFAULT_PROGRAM, stampsRequired: 1, bgColor: 'red', cooldownHours: 500 });
    expect(res.statusCode).toBe(400);
    const msgs = json(res).error.issues.map((i: { message: string }) => i.message);
    expect(msgs).toEqual(expect.arrayContaining(['v.stamps_range', 'v.color', 'v.cooldown_range']));
  });

  it('visible design change re-syncs all cards; cooldown-only change does not', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { cardId } = await joinCustomer(app, slug);
    await prisma.walletSyncJob.deleteMany();

    await owner.client.put('/api/program', { ...DEFAULT_PROGRAM, cooldownHours: 2 });
    expect(await prisma.walletSyncJob.count()).toBe(0);

    await owner.client.put('/api/program', { ...DEFAULT_PROGRAM, bgColor: '#7A1F3D' });
    expect(await prisma.walletSyncJob.count({ where: { cardId } })).toBe(1);
    const p = await prisma.loyaltyProgram.findFirstOrThrow();
    expect(p.designVersion).toBe(2);
  });

  it('logo upload: resized PNG, served publicly; SVG rejected', async () => {
    const { owner, program } = await salonWithProgram(app);
    const big = await sharp({ create: { width: 2000, height: 800, channels: 4, background: '#c97b63' } }).jpeg().toBuffer();
    const { body, contentType } = multipart('logo.jpg', big, 'image/jpeg');
    const res = await app.inject({
      method: 'POST',
      url: '/api/program/logo',
      payload: body,
      headers: { 'content-type': contentType, cookie: (owner.client as any).cookie },
    });
    expect(res.statusCode).toBe(200);
    const logoUrl: string = json(res).program.logoUrl;
    expect(logoUrl).toContain(`/api/public/programs/${program.id}/logo.png?v=`);

    const png = await app.inject({ method: 'GET', url: new URL(logoUrl).pathname });
    expect(png.headers['content-type']).toBe('image/png');
    const meta = await sharp(png.rawPayload).metadata();
    expect(meta.width).toBeLessThanOrEqual(480);
    expect(meta.height).toBeLessThanOrEqual(150);

    const svg = multipart('x.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), 'image/svg+xml');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/program/logo',
      payload: svg.body,
      headers: { 'content-type': svg.contentType, cookie: (owner.client as any).cookie },
    });
    expect(json(bad).error.code).toBe('image_format');
  });

  it('serves strip and square logo images', async () => {
    const { program } = await salonWithProgram(app);
    const strip = await app.inject({ method: 'GET', url: `/api/public/programs/${program.id}/strip/3.png` });
    expect(strip.statusCode).toBe(200);
    expect((await sharp(strip.rawPayload).metadata()).width).toBe(1125);
    expect((await app.inject({ method: 'GET', url: `/api/public/programs/${program.id}/strip/99.png` })).statusCode).toBe(404);
    const square = await app.inject({ method: 'GET', url: `/api/public/programs/${program.id}/logo-square.png` });
    expect((await sharp(square.rawPayload).metadata()).width).toBe(660);
  });
});

describe('poster', () => {
  it('generates a PDF with QR (any member)', async () => {
    const { owner } = await salonWithProgram(app, {}, 'Štúdio Ľubica');
    const staff = await addStaff(app, owner.client, mailer);
    for (const lang of ['sk', 'uk']) {
      const res = await staff.client.get(`/api/poster/poster.pdf?lang=${lang}&size=a5`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    }
    const qr = await owner.client.get('/api/poster/qr.png');
    expect(qr.headers['content-type']).toBe('image/png');
  });

  it('requires a program', async () => {
    const owner = await registerOwner(app);
    expect(json(await owner.client.get('/api/poster/poster.pdf')).error.code).toBe('program_missing');
  });
});

describe('public join page', () => {
  it('shows salon and program without internal fields', async () => {
    const { slug } = await salonWithProgram(app);
    const res = json(await app.inject({ method: 'GET', url: `/api/public/salons/${slug}` }));
    expect(res.name).toBe('Salón Test');
    expect(res.program).toMatchObject({ stampsRequired: 5, rewardText: 'Zľava 15 %' });
    expect(res.program.id).toBeUndefined();
    expect(res.program.cooldownHours).toBeUndefined();
  });

  it('registers a customer with consent; same phone in another format returns the same card', async () => {
    const { slug, salonId } = await salonWithProgram(app);
    const first = await app.inject({
      method: 'POST',
      url: `/api/public/salons/${slug}/join`,
      payload: { name: 'Jana', phone: '0905 123 456', consent: true, locale: 'uk' },
    });
    expect(first.statusCode).toBe(201);
    const customer = await prisma.customer.findFirstOrThrow({ where: { salonId } });
    expect(customer).toMatchObject({ phoneE164: '+421905123456', locale: 'uk', consentVersion: '2026-10-v1' });
    expect(customer.consentAt).toBeInstanceOf(Date);

    const second = await app.inject({
      method: 'POST',
      url: `/api/public/salons/${slug}/join`,
      payload: { name: 'Jana N.', phone: '+421905123456', email: 'jana@test.sk', consent: true },
    });
    expect(json(second).serial).toBe(json(first).serial);
    expect(await prisma.customer.count()).toBe(1);
    // недостающий email дополнился
    expect((await prisma.customer.findFirstOrThrow()).email).toBe('jana@test.sk');
    expect(await prisma.auditLog.count({ where: { action: 'customer.join' } })).toBe(1);
  });

  it('requires consent and at least one contact; validates phone', async () => {
    const { slug } = await salonWithProgram(app);
    const join = (payload: object) => app.inject({ method: 'POST', url: `/api/public/salons/${slug}/join`, payload });

    const noConsent = json(await join({ name: 'A', phone: '0905123456', consent: false }));
    expect(noConsent.error.issues.map((i: any) => i.message)).toContain('v.consent');
    const noContact = json(await join({ name: 'A', consent: true }));
    expect(noContact.error.issues.map((i: any) => i.message)).toContain('v.contact_required');
    const badPhone = json(await join({ name: 'A', phone: '12', consent: true }));
    expect(badPhone.error.code).toBe('phone_invalid');
  });

  it('same phone in two salons → two independent customers', async () => {
    const a = await salonWithProgram(app, {}, 'Salon A');
    const b = await salonWithProgram(app, {}, 'Salon B');
    await joinCustomer(app, a.slug, { phone: '0905111222' });
    await joinCustomer(app, b.slug, { phone: '0905111222' });
    expect(await prisma.customer.count()).toBe(2);
  });

  it('public card page data and QR; wallet buttons hidden when not configured', async () => {
    const { slug } = await salonWithProgram(app);
    const { serial, qrToken } = await joinCustomer(app, slug, { name: 'Jana' });

    const card = json(await app.inject({ method: 'GET', url: `/api/public/cards/${serial}` }));
    expect(card).toMatchObject({ customerName: 'Jana', stampCount: 0, stampsRequired: 5, qrValue: qrToken });
    expect(card.wallet).toEqual({ apple: false, google: false });

    const qr = await app.inject({ method: 'GET', url: `/api/public/cards/${serial}/qr.svg` });
    expect(qr.headers['content-type']).toBe('image/svg+xml');
    expect(qr.body).toContain('<svg');

    expect((await app.inject({ method: 'GET', url: `/api/public/cards/${serial}/pass.pkpass` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/public/cards/${serial}/google` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/public/cards/nope' })).statusCode).toBe(404);
  });
});
