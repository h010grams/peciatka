import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { processWalletJobs } from '../src/services/wallet/sync.js';
import * as appleModule from '../src/services/wallet/apple.js';
import { createTestApp, joinCustomer, json, resetDb, salonWithProgram } from './helpers.js';

// ── Моки внешних сетей: APNs и Google Wallet REST ──
vi.mock('../src/services/wallet/apple.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/wallet/apple.js')>();
  return { ...mod, pushUpdate: vi.fn(async () => ({ invalid: [] as string[] })) };
});

const googleCalls: { method: string; url: string; data?: any }[] = [];
const googleObjects = new Set<string>();
vi.mock('google-auth-library', () => ({
  JWT: class {
    async request(opts: { url: string; method: string; data?: any }) {
      googleCalls.push({ method: opts.method, url: opts.url, data: opts.data });
      const path = opts.url.replace('https://walletobjects.googleapis.com/walletobjects/v1', '');
      if (opts.method === 'GET' && path.startsWith('/loyaltyClass/')) return { status: 404, data: {} };
      if (opts.method === 'PUT' && path.startsWith('/loyaltyObject/')) {
        const id = decodeURIComponent(path.split('/')[2]!);
        return googleObjects.has(id) ? { status: 200, data: {} } : { status: 404, data: {} };
      }
      return { status: 200, data: {} };
    }
  },
}));

let app: FastifyInstance;
let tmp: string;
const PASS_TYPE = 'pass.sk.peciatka.test';

beforeAll(async () => {
  ({ app } = await createTestApp());
  tmp = mkdtempSync(join(tmpdir(), 'wallet-test-'));

  // Самоподписанные сертификаты вместо настоящих Apple: подпись .pkpass проверяем структурно
  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: tmp, stdio: 'pipe' });
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-days', '1', '-subj', '/CN=Pass Type ID: test');
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'wwdr-key.pem', '-out', 'wwdr.pem', '-days', '1', '-subj', '/CN=WWDR test');

  (config as any).apple = {
    passTypeId: PASS_TYPE,
    teamId: 'TEAM123456',
    signerCert: readFileSync(join(tmp, 'cert.pem'), 'utf8'),
    signerKey: readFileSync(join(tmp, 'key.pem'), 'utf8'),
    wwdr: readFileSync(join(tmp, 'wwdr.pem'), 'utf8'),
  };
});

afterAll(async () => {
  (config as any).apple = null;
  (config as any).google = null;
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  googleCalls.length = 0;
  googleObjects.clear();
  vi.mocked(appleModule.pushUpdate).mockClear();
});

function unzip(buf: Buffer) {
  const file = join(tmp, `p-${Date.now()}.pkpass`);
  writeFileSync(file, buf);
  const list = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n');
  const passJson = JSON.parse(execFileSync('unzip', ['-p', file, 'pass.json'], { encoding: 'utf8' }));
  return { list, passJson };
}

describe('Apple Wallet', () => {
  it('generates a signed storeCard .pkpass with stamps, QR and web service', async () => {
    const { slug } = await salonWithProgram(app, {}, 'Nechtové štúdio Žaneta');
    const { serial, qrToken } = await joinCustomer(app, slug, { name: 'Jana', locale: 'sk' });

    const card = json(await app.inject({ method: 'GET', url: `/api/public/cards/${serial}` }));
    expect(card.wallet.apple).toBe(true);

    const res = await app.inject({ method: 'GET', url: `/api/public/cards/${serial}/pass.pkpass` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.pkpass');

    const { list, passJson } = unzip(res.rawPayload);
    expect(list).toEqual(
      expect.arrayContaining(['pass.json', 'manifest.json', 'signature', 'icon.png', 'icon@2x.png', 'strip@3x.png']),
    );
    expect(passJson).toMatchObject({
      passTypeIdentifier: PASS_TYPE,
      teamIdentifier: 'TEAM123456',
      serialNumber: serial,
      organizationName: 'Nechtové štúdio Žaneta',
      logoText: 'Nechtové štúdio Žaneta', // логотипа нет → название текстом
      webServiceURL: 'http://localhost:5174/api/wallet/apple',
      barcodes: [{ format: 'PKBarcodeFormatQR', message: qrToken }],
    });
    expect(passJson.authenticationToken.length).toBeGreaterThanOrEqual(16);
    expect(passJson.storeCard.headerFields[0]).toMatchObject({ key: 'stamps', label: 'Pečiatky', value: '0/5' });
    expect(passJson.storeCard.backFields[0]).toMatchObject({ key: 'notice', changeMessage: '%@' });
  });

  it('PassKit web service: register device, list updates, fetch pass, push on stamp, unregister', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { serial, cardId } = await joinCustomer(app, slug);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    const base = `/api/wallet/apple/v1`;
    const auth = { authorization: `ApplePass ${card.appleAuthToken}` };
    const regUrl = `${base}/devices/device-1/registrations/${PASS_TYPE}/${serial}`;

    // неверный токен
    const bad = await app.inject({ method: 'POST', url: regUrl, headers: { authorization: 'ApplePass wrong-token-123456' }, payload: { pushToken: 'tok' } });
    expect(bad.statusCode).toBe(401);

    expect((await app.inject({ method: 'POST', url: regUrl, headers: auth, payload: { pushToken: 'push-1' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: regUrl, headers: auth, payload: { pushToken: 'push-1' } })).statusCode).toBe(200);

    const list1 = json(await app.inject({ method: 'GET', url: `${base}/devices/device-1/registrations/${PASS_TYPE}` }));
    expect(list1.serialNumbers).toEqual([serial]);
    const tag = list1.lastUpdated;
    expect((await app.inject({ method: 'GET', url: `${base}/devices/device-1/registrations/${PASS_TYPE}?passesUpdatedSince=${tag}` })).statusCode).toBe(204);

    // мастер ставит штамп → push на устройство
    await new Promise((r) => setTimeout(r, 5));
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await processWalletJobs();
    expect(appleModule.pushUpdate).toHaveBeenCalledWith(['push-1']);

    // iPhone спрашивает, что изменилось, и скачивает новую версию
    const list2 = json(await app.inject({ method: 'GET', url: `${base}/devices/device-1/registrations/${PASS_TYPE}?passesUpdatedSince=${tag}` }));
    expect(list2.serialNumbers).toEqual([serial]);
    const passRes = await app.inject({ method: 'GET', url: `${base}/passes/${PASS_TYPE}/${serial}`, headers: auth });
    expect(passRes.statusCode).toBe(200);
    const { passJson } = unzip(passRes.rawPayload);
    expect(passJson.storeCard.headerFields[0].value).toBe('1/5');
    expect(passJson.storeCard.backFields[0].value).toBe('Pribudla pečiatka: 1 z 5. Ďakujeme za návštevu!');

    const lastModified = passRes.headers['last-modified'] as string;
    const notModified = await app.inject({
      method: 'GET',
      url: `${base}/passes/${PASS_TYPE}/${serial}`,
      headers: { ...auth, 'if-modified-since': lastModified },
    });
    expect(notModified.statusCode).toBe(304);

    expect((await app.inject({ method: 'DELETE', url: regUrl, headers: auth })).statusCode).toBe(200);
    expect(await prisma.walletDeviceRegistration.count()).toBe(0);
    expect(await prisma.appleDevice.count()).toBe(0);
  });

  it('removes registrations when APNs says the token is invalid', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { serial, cardId } = await joinCustomer(app, slug);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    await app.inject({
      method: 'POST',
      url: `/api/wallet/apple/v1/devices/dev-x/registrations/${PASS_TYPE}/${serial}`,
      headers: { authorization: `ApplePass ${card.appleAuthToken}` },
      payload: { pushToken: 'dead-token' },
    });
    vi.mocked(appleModule.pushUpdate).mockResolvedValueOnce({ invalid: ['dead-token'] });
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await processWalletJobs();
    expect(await prisma.walletDeviceRegistration.count()).toBe(0);
  });

  it('failed sync is retried later instead of being lost', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { cardId } = await joinCustomer(app, slug);
    await prisma.walletSyncJob.deleteMany();
    await prisma.walletDeviceRegistration.create({
      data: { card: { connect: { id: cardId } }, device: { create: { deviceLibraryId: 'd', pushToken: 't' } } },
    });
    vi.mocked(appleModule.pushUpdate).mockRejectedValueOnce(new Error('APNs 500'));
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await processWalletJobs();
    const job = await prisma.walletSyncJob.findUniqueOrThrow({ where: { cardId } });
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain('APNs 500');
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(job.notify).toContain('Pribudla pečiatka');
  });

  it('deleted customer gets a voided pass', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { serial, cardId } = await joinCustomer(app, slug);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    const customer = await prisma.customer.findFirstOrThrow();
    await owner.client.delete(`/api/customers/${customer.id}`);
    const res = await app.inject({
      method: 'GET',
      url: `/api/wallet/apple/v1/passes/${PASS_TYPE}/${serial}`,
      headers: { authorization: `ApplePass ${card.appleAuthToken}` },
    });
    const { passJson } = unzip(res.rawPayload);
    expect(passJson.voided).toBe(true);
    expect(passJson.storeCard.backFields.find((f: any) => f.key === 'customer').value).toBe('—');
  });
});

describe('Google Wallet', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  beforeAll(() => {
    (config as any).google = {
      issuerId: '3388000000012345678',
      clientEmail: 'wallet@test.iam.gserviceaccount.com',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
  });

  function decodeJwt(url: string) {
    const jwt = url.replace('https://pay.google.com/gp/v/save/', '');
    const [h, p, s] = jwt.split('.');
    const valid = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s!, 'base64url'));
    return { valid, payload: JSON.parse(Buffer.from(p!, 'base64url').toString()) };
  }

  it('save link: creates class, signs JWT with the loyalty object', async () => {
    const { slug, program } = await salonWithProgram(app, { stampsRequired: 10 });
    const { serial, qrToken } = await joinCustomer(app, slug, { name: 'Jana', locale: 'en' });

    const res = await app.inject({ method: 'GET', url: `/api/public/cards/${serial}/google` });
    expect(res.statusCode).toBe(302);
    const { valid, payload } = decodeJwt(res.headers.location as string);
    expect(valid).toBe(true);
    expect(payload).toMatchObject({ aud: 'google', typ: 'savetowallet', iss: 'wallet@test.iam.gserviceaccount.com' });
    expect(payload.origins).toEqual(['http://localhost:5174']);

    const obj = payload.payload.loyaltyObjects[0];
    expect(obj).toMatchObject({
      id: `3388000000012345678.c-${serial}`,
      classId: `3388000000012345678.p-${program.id}`,
      state: 'ACTIVE',
      accountName: 'Jana',
      loyaltyPoints: { label: 'Stamps', balance: { string: '0 / 10' } },
      barcode: { type: 'QR_CODE', value: qrToken },
    });
    expect(obj.heroImage.sourceUri.uri).toContain(`/strip/0.png`);

    // класс создан через REST
    expect(googleCalls.find((c) => c.method === 'POST' && c.url.endsWith('/loyaltyClass'))?.data).toMatchObject({
      issuerName: 'Salón Test',
      programName: 'Vernostná karta',
      hexBackgroundColor: '#1F1F1F',
    });
    const cls = googleCalls.find((c) => c.method === 'POST' && c.url.endsWith('/loyaltyClass'))!.data;
    expect(JSON.stringify(cls.classTemplateInfo)).toContain("object.textModulesData['next']");
    const p = await prisma.loyaltyProgram.findUniqueOrThrow({ where: { id: program.id } });
    expect(p.googleClassId).toBe(`3388000000012345678.p-${program.id}`);
  });

  it('stamp updates the saved object and sends a notifying message', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { serial, cardId } = await joinCustomer(app, slug, { locale: 'sk' });
    await app.inject({ method: 'GET', url: `/api/public/cards/${serial}/google` });
    googleObjects.add(`3388000000012345678.c-${serial}`); // клиентка сохранила карту
    googleCalls.length = 0;

    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await processWalletJobs();

    const put = googleCalls.find((c) => c.method === 'PUT' && c.url.includes('/loyaltyObject/'));
    expect(put?.data.loyaltyPoints.balance.string).toBe('1 / 5');
    const msg = googleCalls.find((c) => c.url.endsWith('/addMessage'));
    expect(msg?.data.message).toMatchObject({
      messageType: 'TEXT_AND_NOTIFY',
      body: 'Pribudla pečiatka: 1 z 5. Ďakujeme za návštevu!',
    });
  });

  it('object that was never saved (404) is not an error', async () => {
    const { owner, slug } = await salonWithProgram(app);
    const { serial, cardId } = await joinCustomer(app, slug);
    await app.inject({ method: 'GET', url: `/api/public/cards/${serial}/google` });
    await owner.client.post(`/api/cards/${cardId}/stamps`);
    await processWalletJobs();
    expect(await prisma.walletSyncJob.count()).toBe(0); // задача завершилась без повтора
    expect(googleCalls.some((c) => c.url.endsWith('/addMessage'))).toBe(false);
  });
});

describe('next appointment on the card face', () => {
  it('Apple: auxiliary field with the date; Google: text module "next"', async () => {
    (config as any).google = {
      issuerId: '3388000000012345678',
      clientEmail: 'wallet@test.iam.gserviceaccount.com',
      privateKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    const { owner, slug } = await salonWithProgram(app);
    const { serial, cardId } = await joinCustomer(app, slug);
    const startsAt = new Date(Date.now() + 3 * 24 * 3600_000);
    const local = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(startsAt).replace(' ', 'T');
    await owner.client.put(`/api/cards/${cardId}/appointment`, { startsAt: local });

    const { passJson } = unzip((await app.inject({ method: 'GET', url: `/api/public/cards/${serial}/pass.pkpass` })).rawPayload);
    const aux = passJson.storeCard.auxiliaryFields[0];
    expect(aux).toMatchObject({ key: 'next', label: 'Ďalšia návšteva', dateStyle: 'PKDateStyleMedium', timeStyle: 'PKDateStyleShort' });
    expect(Math.abs(Date.parse(aux.value) - startsAt.getTime())).toBeLessThan(60_000);
    expect(passJson.relevantDate).toBe(aux.value); // iPhone подсветит карту на экране блокировки в день визита

    const res = await app.inject({ method: 'GET', url: `/api/public/cards/${serial}/google` });
    const payload = JSON.parse(Buffer.from((res.headers.location as string).split('/save/')[1]!.split('.')[1]!, 'base64url').toString());
    const next = payload.payload.loyaltyObjects[0].textModulesData.find((m: any) => m.id === 'next');
    expect(next.header).toBe('Ďalšia návšteva');
    expect(next.body).toMatch(/\d{2}:\d{2}/);
  });
});
