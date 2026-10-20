import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import { prisma } from '../src/lib/prisma.js';

export async function createTestApp() {
  const mailer = new MemoryMailer();
  const app = await buildApp({ mailer, rateLimit: false, webDistDir: '/nonexistent' });
  return { app, mailer };
}

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}

/** Клиент с «браузерной» cookie-банкой поверх app.inject. */
export class TestClient {
  private cookie: string | null = null;
  constructor(private app: FastifyInstance) {}

  async request(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown) {
    const res = await this.app.inject({
      method,
      url,
      payload: body as Record<string, unknown> | undefined,
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
    const sid = res.cookies.find((c) => c.name === 'sid');
    if (sid) this.cookie = sid.value ? `sid=${sid.value}` : null;
    return res;
  }
  get = (url: string) => this.request('GET', url);
  post = (url: string, body?: unknown) => this.request('POST', url, body ?? {});
  patch = (url: string, body?: unknown) => this.request('PATCH', url, body ?? {});
  put = (url: string, body?: unknown) => this.request('PUT', url, body ?? {});
  delete = (url: string) => this.request('DELETE', url);
}

export function json<T = any>(res: LightMyRequestResponse): T {
  return res.json() as T;
}

let counter = 0;
export async function registerOwner(app: FastifyInstance, salonName = 'Salón Test') {
  counter += 1;
  const client = new TestClient(app);
  const email = `owner${counter}@test.sk`;
  const res = await client.post('/api/auth/register', {
    salonName,
    name: `Owner ${counter}`,
    email,
    password: 'password123',
    locale: 'sk',
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  return { client, email, me: json(res) };
}

/** Приглашает мастера и принимает приглашение; возвращает клиента мастера. */
export async function addStaff(app: FastifyInstance, owner: TestClient, mailer: MemoryMailer) {
  counter += 1;
  const email = `staff${counter}@test.sk`;
  const res = await owner.post('/api/staff/invites', { email });
  if (res.statusCode !== 201) throw new Error(`invite failed: ${res.body}`);
  const token = (json(res).url as string).split('/invite/')[1]!;
  const staff = new TestClient(app);
  const acc = await staff.post(`/api/invites/${token}/accept`, { name: 'Master', password: 'password123' });
  if (acc.statusCode !== 200) throw new Error(`accept failed: ${acc.body}`);
  return { client: staff, email, me: json(acc) };
}

export const DEFAULT_PROGRAM = {
  name: 'Vernostná karta',
  stampsRequired: 5,
  rewardText: 'Zľava 15 %',
  cooldownHours: 12,
  bgColor: '#1F1F1F',
  fgColor: '#FFFFFF',
  labelColor: '#C9A96E',
};

/** Салон с владельцем и программой. */
export async function salonWithProgram(app: FastifyInstance, program: Partial<typeof DEFAULT_PROGRAM> = {}, name = 'Salón Test') {
  const owner = await registerOwner(app, name);
  const put = await owner.client.put('/api/program', { ...DEFAULT_PROGRAM, ...program });
  if (put.statusCode !== 200) throw new Error(`program failed: ${put.body}`);
  const salon = json(await owner.client.get('/api/salon'));
  return { owner, slug: salon.slug as string, salonId: salon.id as string, program: json(put).program };
}

let phoneCounter = 100000;
/** Клиентка регистрируется по QR; возвращает serial и id карты. */
export async function joinCustomer(app: FastifyInstance, slug: string, body: Record<string, unknown> = {}) {
  phoneCounter += 1;
  const res = await app.inject({
    method: 'POST',
    url: `/api/public/salons/${slug}/join`,
    payload: { name: 'Jana Nováková', phone: `0905${phoneCounter}`, consent: true, locale: 'sk', ...body },
  });
  if (res.statusCode !== 201) throw new Error(`join failed: ${res.body}`);
  const serial = json(res).serial as string;
  const card = await prisma.card.findUniqueOrThrow({ where: { serialNumber: serial } });
  return { serial, cardId: card.id, qrToken: card.qrToken };
}
