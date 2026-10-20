import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma.js';
import type { MemoryMailer } from '../src/lib/mailer.js';
import { addStaff, createTestApp, json, registerOwner, resetDb, TestClient } from './helpers.js';

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

describe('tenant isolation', () => {
  it('owner sees only own salon and own staff', async () => {
    const a = await registerOwner(app, 'Salon A');
    const b = await registerOwner(app, 'Salon B');
    await addStaff(app, b.client, mailer);

    const salonA = json(await a.client.get('/api/salon'));
    expect(salonA.name).toBe('Salon A');

    const staffA = json(await a.client.get('/api/staff'));
    expect(staffA.members).toHaveLength(1); // только сам владелец
  });

  it('cannot switch into a salon without membership', async () => {
    const a = await registerOwner(app, 'Salon A');
    const b = await registerOwner(app, 'Salon B');
    const res = await a.client.post('/api/auth/switch-salon', { salonId: b.me.currentSalonId });
    expect(res.statusCode).toBe(403);
  });

  it('cannot modify members or invites of another salon by id', async () => {
    const a = await registerOwner(app, 'Salon A');
    const b = await registerOwner(app, 'Salon B');
    const bStaff = await addStaff(app, b.client, mailer);
    const bInvite = json(await b.client.post('/api/staff/invites', { email: 'x@test.sk' }));

    const membership = await prisma.membership.findFirstOrThrow({
      where: { user: { email: bStaff.email } },
    });
    const patch = await a.client.patch(`/api/staff/members/${membership.id}`, { active: false });
    expect(patch.statusCode).toBe(404);

    const del = await a.client.delete(`/api/staff/invites/${bInvite.id}`);
    expect(del.statusCode).toBe(404);

    const still = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(still.active).toBe(true);
  });

  it('anonymous requests are rejected', async () => {
    const anon = new TestClient(app);
    expect((await anon.get('/api/salon')).statusCode).toBe(401);
    expect((await anon.get('/api/staff')).statusCode).toBe(401);
  });
});

describe('roles', () => {
  it('staff can read salon but cannot manage team or edit salon', async () => {
    const owner = await registerOwner(app);
    const staff = await addStaff(app, owner.client, mailer);

    expect(staff.me.salons[0].role).toBe('STAFF');
    expect((await staff.client.get('/api/salon')).statusCode).toBe(200);
    expect((await staff.client.get('/api/staff')).statusCode).toBe(403);
    expect((await staff.client.post('/api/staff/invites', { email: 'z@test.sk' })).statusCode).toBe(403);
    expect((await staff.client.patch('/api/salon', { name: 'Hacked' })).statusCode).toBe(403);
  });

  it('owner edits salon and it is audited', async () => {
    const owner = await registerOwner(app);
    const res = await owner.client.patch('/api/salon', { name: 'Nový názov', address: 'Hlavná 1, Bratislava' });
    expect(res.statusCode).toBe(200);
    expect(json(res).name).toBe('Nový názov');
    const log = await prisma.auditLog.findFirst({ where: { action: 'salon.update' } });
    expect(log?.actorUserId).toBe(owner.me.user.id);
  });

  it('deactivated staff immediately loses access; reactivation restores it', async () => {
    const owner = await registerOwner(app);
    const staff = await addStaff(app, owner.client, mailer);
    const members = json(await owner.client.get('/api/staff')).members;
    const m = members.find((x: { email: string }) => x.email === staff.email);

    await owner.client.patch(`/api/staff/members/${m.membershipId}`, { active: false });
    expect((await staff.client.get('/api/salon')).statusCode).toBe(403);

    await owner.client.patch(`/api/staff/members/${m.membershipId}`, { active: true });
    expect((await staff.client.get('/api/salon')).statusCode).toBe(200);
  });

  it('owner cannot modify own membership', async () => {
    const owner = await registerOwner(app);
    const me = json(await owner.client.get('/api/staff')).members[0];
    const res = await owner.client.patch(`/api/staff/members/${me.membershipId}`, { active: false });
    expect(json(res).error.code).toBe('cannot_modify_self');
  });
});

describe('invites', () => {
  it('sends email, accepts once, logs staff.join', async () => {
    const owner = await registerOwner(app);
    const res = await owner.client.post('/api/staff/invites', { email: 'Master@Test.sk' });
    expect(res.statusCode).toBe(201);
    expect(mailer.outbox[0]!.to).toBe('master@test.sk');

    const token = (json(res).url as string).split('/invite/')[1]!;
    const anon = new TestClient(app);
    const info = json(await anon.get(`/api/invites/${token}`));
    expect(info).toMatchObject({ email: 'master@test.sk', role: 'STAFF', userExists: false });

    const missing = await anon.post(`/api/invites/${token}/accept`, {});
    expect(json(missing).error.code).toBe('name_password_required');

    const ok = await anon.post(`/api/invites/${token}/accept`, { name: 'Jana', password: 'password123' });
    expect(ok.statusCode).toBe(200);

    const reuse = await new TestClient(app).post(`/api/invites/${token}/accept`, {
      name: 'X',
      password: 'password123',
    });
    expect(json(reuse).error.code).toBe('invite_invalid');

    expect(await prisma.auditLog.count({ where: { action: 'staff.join' } })).toBe(1);
  });

  it('existing user from another salon must log in, then joins second salon', async () => {
    const a = await registerOwner(app, 'Salon A');
    const b = await registerOwner(app, 'Salon B');
    const res = await b.client.post('/api/staff/invites', { email: a.email });
    const token = (json(res).url as string).split('/invite/')[1]!;

    const anon = await new TestClient(app).post(`/api/invites/${token}/accept`, {});
    expect(json(anon).error.code).toBe('login_required');

    const accepted = await a.client.post(`/api/invites/${token}/accept`, {});
    expect(accepted.statusCode).toBe(200);
    const me = json(accepted);
    expect(me.salons).toHaveLength(2);
    expect(me.currentSalonId).toBe(b.me.currentSalonId);

    // переключается обратно в свой салон
    const sw = await a.client.post('/api/auth/switch-salon', { salonId: a.me.currentSalonId });
    expect(sw.statusCode).toBe(200);
  });

  it('logged-in user with different email cannot accept', async () => {
    const owner = await registerOwner(app);
    const other = await registerOwner(app, 'Other');
    const res = await owner.client.post('/api/staff/invites', { email: 'someone@test.sk' });
    const token = (json(res).url as string).split('/invite/')[1]!;
    const r = await other.client.post(`/api/invites/${token}/accept`, {});
    expect(json(r).error.code).toBe('invite_email_mismatch');
  });

  it('expired invite is invalid', async () => {
    const owner = await registerOwner(app);
    const res = await owner.client.post('/api/staff/invites', { email: 'late@test.sk' });
    const token = (json(res).url as string).split('/invite/')[1]!;
    await prisma.invite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await new TestClient(app).get(`/api/invites/${token}`)).statusCode).toBe(404);
  });

  it('cannot invite an active member twice', async () => {
    const owner = await registerOwner(app);
    const staff = await addStaff(app, owner.client, mailer);
    const res = await owner.client.post('/api/staff/invites', { email: staff.email });
    expect(json(res).error.code).toBe('already_member');
  });
});
