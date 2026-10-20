import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import type { CustomerDetailDto, CustomerListItem, CustomerListResponse, HistoryItem } from '@peciatka/shared';
import { audit } from '../../lib/audit.js';
import { assertUuid, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { requireTenant } from '../../plugins/auth.js';
import { enqueueWalletSync, kickWalletWorker } from '../../services/wallet/sync.js';

type Row = {
  id: string;
  name: string;
  phoneE164: string | null;
  email: string | null;
  createdAt: Date;
  cardId: string | null;
  totalVisits: number;
  stampCount: number;
  rewardsAvailable: number;
  lastStampAt: Date | null;
};

function toItem(r: Row): CustomerListItem {
  return {
    id: r.id,
    cardId: r.cardId,
    name: r.name,
    phone: r.phoneE164,
    email: r.email,
    totalVisits: Number(r.totalVisits),
    stampCount: Number(r.stampCount),
    rewardsAvailable: Number(r.rewardsAvailable),
    lastVisitAt: r.lastStampAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

const SORTS = {
  recent: Prisma.sql`k."lastStampAt" DESC NULLS LAST, c."createdAt" DESC`,
  visits: Prisma.sql`"totalVisits" DESC, c.name ASC`,
  name: Prisma.sql`c.name ASC`,
  new: Prisma.sql`c."createdAt" DESC`,
} as const;

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

async function queryCustomers(salonId: string, opts: { q?: string; sort?: string; limit: number; offset: number; id?: string }) {
  const q = (opts.q ?? '').trim();
  const conditions: Prisma.Sql[] = [Prisma.sql`c."salonId" = ${salonId}::uuid`, Prisma.sql`c."anonymizedAt" IS NULL`];
  if (opts.id) conditions.push(Prisma.sql`c.id = ${opts.id}::uuid`);
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    // «0905 123 456» → ищем «905123456» в +421905123456
    const digits = q.replace(/\D/g, '').replace(/^0+/, '');
    conditions.push(
      digits.length >= 3
        ? Prisma.sql`(c.name ILIKE ${pattern} OR c.email ILIKE ${pattern} OR c."phoneE164" LIKE ${`%${digits}%`})`
        : Prisma.sql`(c.name ILIKE ${pattern} OR c.email ILIKE ${pattern})`,
    );
  }
  const where = Prisma.join(conditions, ' AND ');
  const order = SORTS[(opts.sort as keyof typeof SORTS) ?? 'recent'] ?? SORTS.recent;

  const [rows, count] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT c.id, c.name, c."phoneE164", c.email, c."createdAt",
             k.id AS "cardId",
             COALESCE(k."totalVisits", 0) AS "totalVisits",
             COALESCE(k."stampCount", 0) AS "stampCount",
             COALESCE(k."rewardsAvailable", 0) AS "rewardsAvailable",
             k."lastStampAt"
      FROM "Customer" c
      LEFT JOIN "Card" k ON k."customerId" = c.id AND k.status = 'ACTIVE'
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${opts.limit} OFFSET ${opts.offset}`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Customer" c WHERE ${where}`,
  ]);
  return { rows, total: Number(count[0]?.n ?? 0) };
}

async function history(cardIds: string[]): Promise<HistoryItem[]> {
  if (cardIds.length === 0) return [];
  const [events, rewards] = await Promise.all([
    prisma.stampEvent.findMany({ where: { cardId: { in: cardIds } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.reward.findMany({ where: { cardId: { in: cardIds } }, orderBy: { earnedAt: 'desc' }, take: 50 }),
  ]);
  const userIds = [
    ...new Set([...events.map((e) => e.actorUserId), ...rewards.map((r) => r.redeemedByUserId).filter((x): x is string => !!x)]),
  ];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? null) : null);

  const items: HistoryItem[] = [
    ...events.map((e) => ({
      id: e.id,
      type: e.type === 'ADD' ? ('STAMP' as const) : ('STAMP_REVOKED' as const),
      at: e.createdAt.toISOString(),
      actorName: nameOf(e.actorUserId),
    })),
    ...rewards.filter((r) => r.status !== 'VOID').map((r) => ({
      id: `${r.id}-earned`,
      type: 'REWARD_EARNED' as const,
      at: r.earnedAt.toISOString(),
      actorName: null,
    })),
    ...rewards
      .filter((r) => r.redeemedAt)
      .map((r) => ({
        id: `${r.id}-redeemed`,
        type: 'REWARD_REDEEMED' as const,
        at: r.redeemedAt!.toISOString(),
        actorName: nameOf(r.redeemedByUserId),
      })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
}

/** /api/customers */
export const customerRoutes: FastifyPluginAsync = async (app) => {
  // Поиск нужен и мастеру: если камера не сработала, клиентку находят по имени/телефону.
  app.get<{ Querystring: { q?: string; sort?: string; limit?: string; offset?: string } }>(
    '/',
    { preHandler: requireTenant() },
    async (req): Promise<CustomerListResponse> => {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const { rows, total } = await queryCustomers(req.tenant!.salonId, { q: req.query.q, sort: req.query.sort, limit, offset });
      return { items: rows.map(toItem), total };
    },
  );

  app.get<{ Params: { id: string } }>('/:id', { preHandler: requireTenant() }, async (req): Promise<CustomerDetailDto> => {
    const { salonId } = req.tenant!;
    const id = assertUuid(req.params.id);
    const { rows } = await queryCustomers(salonId, { id, limit: 1, offset: 0 });
    const customer = await prisma.customer.findFirst({ where: { id, salonId, anonymizedAt: null }, include: { cards: true } });
    if (!rows[0] || !customer) throw notFound('customer_not_found');
    return {
      ...toItem(rows[0]),
      locale: customer.locale,
      consentAt: customer.consentAt.toISOString(),
      consentVersion: customer.consentVersion,
      history: await history(customer.cards.map((c) => c.id)),
    };
  });

  // GDPR: право на доступ — все данные клиентки одним файлом
  app.get<{ Params: { id: string } }>('/:id/export', { preHandler: requireTenant('OWNER') }, async (req, reply) => {
    const { salonId } = req.tenant!;
    const id = assertUuid(req.params.id);
    const customer = await prisma.customer.findFirst({
      where: { id, salonId, anonymizedAt: null },
      include: {
        salon: { select: { name: true, address: true, phone: true } },
        cards: {
          include: {
            program: { select: { name: true, stampsRequired: true, rewardText: true } },
            stampEvents: { orderBy: { createdAt: 'asc' }, select: { type: true, createdAt: true } },
            rewards: { orderBy: { earnedAt: 'asc' }, select: { status: true, earnedAt: true, redeemedAt: true } },
            appointments: { orderBy: { startsAt: 'asc' }, select: { startsAt: true, cancelledAt: true } },
          },
        },
      },
    });
    if (!customer) throw notFound('customer_not_found');

    await audit(prisma, {
      salonId,
      actorUserId: req.auth!.user.id,
      action: 'customer.export',
      entityType: 'customer',
      entityId: id,
    });

    const data = {
      exportedAt: new Date().toISOString(),
      controller: customer.salon,
      customer: {
        name: customer.name,
        phone: customer.phoneE164,
        email: customer.email,
        language: customer.locale,
        registeredAt: customer.createdAt,
        consent: { givenAt: customer.consentAt, textVersion: customer.consentVersion },
      },
      cards: customer.cards.map((c) => ({
        program: c.program,
        stampCount: c.stampCount,
        rewardsAvailable: c.rewardsAvailable,
        totalVisits: c.totalVisits,
        createdAt: c.createdAt,
        stamps: c.stampEvents,
        rewards: c.rewards,
        appointments: c.appointments,
      })),
    };
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="customer-${id.slice(0, 8)}.json"`)
      .send(JSON.stringify(data, null, 2));
  });

  /**
   * GDPR: право на удаление. Персональные данные стираются, карта аннулируется
   * в Wallet; обезличенные визиты остаются, чтобы не ломать статистику.
   */
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: requireTenant('OWNER') }, async (req, reply) => {
    const { salonId } = req.tenant!;
    const id = assertUuid(req.params.id);
    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id, salonId, anonymizedAt: null }, include: { cards: true } });
      if (!customer) throw notFound('customer_not_found');
      const now = new Date();
      await tx.customer.update({
        where: { id },
        data: { name: '—', phoneE164: null, email: null, anonymizedAt: now },
      });
      for (const card of customer.cards) {
        await tx.card.update({
          where: { id: card.id },
          data: { status: 'VOIDED', walletNotice: null, walletUpdatedAt: now },
        });
        await tx.appointment.updateMany({ where: { cardId: card.id, cancelledAt: null }, data: { cancelledAt: now } });
        await enqueueWalletSync(tx, card.id); // Apple: voided, Google: INACTIVE
      }
      await audit(tx, {
        salonId,
        actorUserId: req.auth!.user.id,
        action: 'customer.delete',
        entityType: 'customer',
        entityId: id,
      });
    });
    kickWalletWorker();
    return reply.code(204).send();
  });
};
