import type { FastifyPluginAsync } from 'fastify';
import { fromZonedTime } from 'date-fns-tz';
import { appointmentSchema, type StampResultDto } from '@peciatka/shared';
import { assertUuid, badRequest, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { requireTenant } from '../../plugins/auth.js';
import * as cards from '../../services/cards.js';

type IdParams = { Params: { id: string } };

/** /api/cards — действия мастера (любая роль салона). */
export const cardRoutes: FastifyPluginAsync = async (app) => {
  const member = { preHandler: requireTenant() };
  // Защита от случайных повторных нажатий и перебора QR-токенов
  const actionLimit = { ...member, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  app.get<{ Params: { token: string } }>('/by-qr/:token', actionLimit, async (req) => {
    const token = req.params.token.trim();
    if (!/^[\w-]{10,64}$/.test(token)) throw notFound('card_not_found');
    const id = await cards.findCardIdByQr(req.tenant!.salonId, token);
    return cards.getStaffCard(req.tenant!.salonId, id);
  });

  app.get<IdParams>('/:id', member, async (req) => {
    return cards.getStaffCard(req.tenant!.salonId, assertUuid(req.params.id, 'card_not_found'));
  });

  app.post<IdParams>('/:id/stamps', actionLimit, async (req): Promise<StampResultDto> => {
    const { salonId } = req.tenant!;
    const id = assertUuid(req.params.id, 'card_not_found');
    const { rewardEarned } = await cards.addStamp(salonId, id, req.auth!.user.id);
    return { card: await cards.getStaffCard(salonId, id), rewardEarned };
  });

  app.post<IdParams>('/:id/stamps/revoke-last', actionLimit, async (req) => {
    const { salonId } = req.tenant!;
    const id = assertUuid(req.params.id, 'card_not_found');
    await cards.revokeLastStamp(salonId, id, req.auth!.user.id);
    return { card: await cards.getStaffCard(salonId, id) };
  });

  app.post<IdParams>('/:id/rewards/redeem', actionLimit, async (req) => {
    const { salonId } = req.tenant!;
    const id = assertUuid(req.params.id, 'card_not_found');
    await cards.redeemReward(salonId, id, req.auth!.user.id);
    return { card: await cards.getStaffCard(salonId, id) };
  });

  app.put<IdParams>('/:id/appointment', actionLimit, async (req) => {
    const { salonId } = req.tenant!;
    const id = assertUuid(req.params.id, 'card_not_found');
    const { startsAt } = parse(appointmentSchema, req.body);
    const salon = await prisma.salon.findUniqueOrThrow({ where: { id: salonId } });
    // мастер вводит местное время салона → храним UTC
    const utc = fromZonedTime(startsAt, salon.timezone);
    const now = Date.now();
    if (Number.isNaN(utc.getTime()) || utc.getTime() <= now || utc.getTime() > now + 366 * 24 * 3600_000) {
      throw badRequest('appointment_invalid');
    }
    await cards.setAppointment(salonId, id, req.auth!.user.id, utc);
    return { card: await cards.getStaffCard(salonId, id) };
  });

  app.delete<IdParams>('/:id/appointment', actionLimit, async (req) => {
    const { salonId } = req.tenant!;
    const id = assertUuid(req.params.id, 'card_not_found');
    await cards.cancelAppointment(salonId, id, req.auth!.user.id);
    return { card: await cards.getStaffCard(salonId, id) };
  });
};
