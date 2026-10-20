import type { FastifyPluginAsync } from 'fastify';
import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { STATS_PERIODS, type AuditItem, type StatsDto, type StatsPeriod } from '@peciatka/shared';
import { prisma } from '../../lib/prisma.js';
import { requireTenant } from '../../plugins/auth.js';

const DAYS: Record<StatsPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Границы периода — по календарным дням в часовом поясе салона. */
export function periodRange(period: StatsPeriod, timeZone: string, now = new Date()) {
  const today = formatInTimeZone(now, timeZone, 'yyyy-MM-dd');
  const firstDay = format(addDays(parseISO(today), -(DAYS[period] - 1)), 'yyyy-MM-dd');
  const days: string[] = [];
  for (let i = 0; i < DAYS[period]; i++) days.push(format(addDays(parseISO(firstDay), i), 'yyyy-MM-dd'));
  return { from: fromZonedTime(`${firstDay}T00:00:00`, timeZone), to: now, days };
}

const n = (rows: { n: bigint | number }[]) => Number(rows[0]?.n ?? 0);

export async function computeStats(salonId: string, period: StatsPeriod, now = new Date()): Promise<StatsDto> {
  const salon = await prisma.salon.findUniqueOrThrow({ where: { id: salonId } });
  const tz = salon.timezone;
  const { from, to, days } = periodRange(period, tz, now);

  // «Действующие» штампы — без отменённых
  const [newCustomers, visits, active, returning, earned, redeemed, total, daily] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Customer"
      WHERE "salonId" = ${salonId}::uuid AND "createdAt" >= ${from} AND "createdAt" <= ${to}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "StampEvent" e
      WHERE e."salonId" = ${salonId}::uuid AND e.type = 'ADD' AND e."createdAt" >= ${from} AND e."createdAt" <= ${to}
        AND NOT EXISTS (SELECT 1 FROM "StampEvent" r WHERE r."revokesEventId" = e.id)`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT e."cardId") AS n FROM "StampEvent" e
      WHERE e."salonId" = ${salonId}::uuid AND e.type = 'ADD' AND e."createdAt" >= ${from} AND e."createdAt" <= ${to}
        AND NOT EXISTS (SELECT 1 FROM "StampEvent" r WHERE r."revokesEventId" = e.id)`,
    // вернулись = пришли в периоде и у них был более ранний визит
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT e."cardId") AS n FROM "StampEvent" e
      WHERE e."salonId" = ${salonId}::uuid AND e.type = 'ADD' AND e."createdAt" >= ${from} AND e."createdAt" <= ${to}
        AND NOT EXISTS (SELECT 1 FROM "StampEvent" r WHERE r."revokesEventId" = e.id)
        AND EXISTS (
          SELECT 1 FROM "StampEvent" p
          WHERE p."cardId" = e."cardId" AND p.type = 'ADD' AND p."createdAt" < e."createdAt"
            AND NOT EXISTS (SELECT 1 FROM "StampEvent" r2 WHERE r2."revokesEventId" = p.id)
        )`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Reward"
      WHERE "salonId" = ${salonId}::uuid AND status <> 'VOID' AND "earnedAt" >= ${from} AND "earnedAt" <= ${to}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Reward"
      WHERE "salonId" = ${salonId}::uuid AND status = 'REDEEMED' AND "redeemedAt" >= ${from} AND "redeemedAt" <= ${to}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Customer" WHERE "salonId" = ${salonId}::uuid AND "anonymizedAt" IS NULL`,
    prisma.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char(e."createdAt" AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, count(*) AS n
      FROM "StampEvent" e
      WHERE e."salonId" = ${salonId}::uuid AND e.type = 'ADD' AND e."createdAt" >= ${from} AND e."createdAt" <= ${to}
        AND NOT EXISTS (SELECT 1 FROM "StampEvent" r WHERE r."revokesEventId" = e.id)
      GROUP BY 1`,
  ]);

  const byDay = new Map(daily.map((d) => [d.day, Number(d.n)]));
  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    newCustomers: n(newCustomers),
    visits: n(visits),
    activeCustomers: n(active),
    returningCustomers: n(returning),
    rewardsEarned: n(earned),
    rewardsRedeemed: n(redeemed),
    totalCustomers: n(total),
    daily: days.map((date) => ({ date, visits: byDay.get(date) ?? 0 })),
  };
}

/** /api/stats и /api/audit — только владелец. */
export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { period?: string } }>('/stats', { preHandler: requireTenant('OWNER') }, async (req) => {
    const period = (STATS_PERIODS as readonly string[]).includes(req.query.period ?? '')
      ? (req.query.period as StatsPeriod)
      : '30d';
    return computeStats(req.tenant!.salonId, period);
  });

  app.get<{ Querystring: { before?: string } }>('/audit', { preHandler: requireTenant('OWNER') }, async (req) => {
    const before = req.query.before ? new Date(req.query.before) : null;
    const logs = await prisma.auditLog.findMany({
      where: {
        salonId: req.tenant!.salonId,
        ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const ids = [...new Set(logs.map((l) => l.actorUserId).filter((x): x is string => !!x))];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const items: AuditItem[] = logs.map((l) => ({
      id: l.id,
      action: l.action,
      actorName: users.find((u) => u.id === l.actorUserId)?.name ?? null,
      entityType: l.entityType,
      entityId: l.entityId,
      payload: l.payload,
      createdAt: l.createdAt.toISOString(),
    }));
    return { items };
  });
};
