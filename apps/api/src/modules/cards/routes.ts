import type { FastifyPluginAsync } from 'fastify';
import { fromZonedTime } from 'date-fns-tz';
import QRCode from 'qrcode';
import { appointmentSchema, joinSchema, type CounterRegisterResponse, type StampResultDto } from '@peciatka/shared';
import { assertUuid, badRequest, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { requireTenant } from '../../plugins/auth.js';
import * as cards from '../../services/cards.js';
import { registerCustomer } from '../../services/registration.js';
import { urls } from '../../services/urls.js';

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

  // Регистрация клиентки на кассе: администратор вводит имя и телефон, клиентка соглашается устно
  app.post('/register', actionLimit, async (req, reply): Promise<CounterRegisterResponse> => {
    const input = parse(joinSchema, req.body);
    const r = await registerCustomer(req.tenant!.salonId, input, { actorUserId: req.auth!.user.id, source: 'counter' });
    reply.code(r.created ? 201 : 200);
    return { cardId: r.cardId, created: r.created, firstStamp: r.firstStamp };
  });

  // QR со ссылкой на карту клиентки: она сканирует его своим телефоном и добавляет карту в Wallet
  app.get<IdParams>('/:id/wallet-qr.svg', member, async (req, reply) => {
    const card = await prisma.card.findFirst({
      where: { id: assertUuid(req.params.id, 'card_not_found'), salonId: req.tenant!.salonId, status: 'ACTIVE' },
      select: { serialNumber: true },
    });
    if (!card) throw notFound('card_not_found');
    const svg = await QRCode.toString(urls.cardPage(card.serialNumber), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return reply.header('Content-Type', 'image/svg+xml').header('Cache-Control', 'private, no-store').send(svg);
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
