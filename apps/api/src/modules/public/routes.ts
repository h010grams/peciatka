import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import QRCode from 'qrcode';
import { joinSchema, type PublicCardDto, type PublicSalonDto } from '@peciatka/shared';
import { assertUuid, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { squareLogo, stripPng } from '../../services/images.js';
import { registerCustomer } from '../../services/registration.js';
import * as apple from '../../services/wallet/apple.js';
import * as google from '../../services/wallet/google.js';
import { loadWalletCard, type WalletCard } from '../../services/walletCard.js';
import { toProgramDto } from '../program/routes.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';

export function toPublicCard(card: WalletCard): PublicCardDto {
  const program = toProgramDto(card.program);
  return {
    serial: card.serialNumber,
    qrValue: card.qrToken,
    salonName: card.salon.name,
    salonSlug: card.salon.slug,
    customerName: card.customer.name,
    programName: program.name,
    stampCount: card.stampCount,
    stampsRequired: program.stampsRequired,
    rewardsAvailable: card.rewardsAvailable,
    rewardText: program.rewardText,
    bgColor: program.bgColor,
    fgColor: program.fgColor,
    labelColor: program.labelColor,
    logoUrl: program.logoUrl,
    nextAppointmentAt: card.appointments[0]?.startsAt.toISOString() ?? null,
    timezone: card.salon.timezone,
    wallet: { apple: apple.appleEnabled(), google: google.googleEnabled() },
  };
}

async function activeCard(serial: string) {
  const card = await loadWalletCard({ serialNumber: serial });
  if (!card || card.status !== 'ACTIVE') throw notFound('card_not_found');
  return card;
}

function sendPng(reply: FastifyReply, png: Buffer) {
  return reply.header('Content-Type', 'image/png').header('Cache-Control', IMMUTABLE).send(png);
}

/** /api/public — без авторизации: клиентки, Google и Apple. */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  const joinLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
  const readLimit = { rateLimit: { max: 120, timeWindow: '1 minute' } };

  // ───────── Салон и регистрация ─────────

  app.get<{ Params: { slug: string } }>('/salons/:slug', { config: readLimit }, async (req): Promise<PublicSalonDto> => {
    const salon = await prisma.salon.findUnique({ where: { slug: req.params.slug }, include: { programs: true } });
    if (!salon) throw notFound('salon_not_found');
    const p = salon.programs.find((x) => x.isActive);
    let program: PublicSalonDto['program'] = null;
    if (p) {
      const { id: _id, cooldownHours: _c, firstStampOnJoin: _f, ...rest } = toProgramDto(p);
      program = rest;
    }
    return { name: salon.name, slug: salon.slug, address: salon.address, phone: salon.phone, program };
  });

  app.post<{ Params: { slug: string } }>('/salons/:slug/join', { config: joinLimit }, async (req, reply) => {
    const input = parse(joinSchema, req.body);
    const salon = await prisma.salon.findUnique({ where: { slug: req.params.slug }, select: { id: true } });
    if (!salon) throw notFound('salon_not_found');
    const { serial } = await registerCustomer(salon.id, input, { actorUserId: null, source: 'poster' });
    return reply.code(201).send({ serial });
  });

  // ───────── Карта клиентки ─────────

  app.get<{ Params: { serial: string } }>('/cards/:serial', { config: readLimit }, async (req) => {
    return toPublicCard(await activeCard(assertUuid(req.params.serial, 'card_not_found')));
  });

  app.get<{ Params: { serial: string } }>('/cards/:serial/qr.svg', { config: readLimit }, async (req, reply) => {
    const card = await activeCard(assertUuid(req.params.serial, 'card_not_found'));
    const svg = await QRCode.toString(card.qrToken, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return reply.header('Content-Type', 'image/svg+xml').header('Cache-Control', 'private, max-age=300').send(svg);
  });

  /** Кнопка «Save to Google Wallet» ведёт сюда → редирект на pay.google.com с подписанным JWT. */
  app.get<{ Params: { serial: string } }>('/cards/:serial/google', { config: joinLimit }, async (req, reply) => {
    if (!google.googleEnabled()) throw notFound('google_disabled');
    const card = await activeCard(assertUuid(req.params.serial, 'card_not_found'));
    return reply.redirect(await google.saveUrl(card));
  });

  /** Кнопка «Add to Apple Wallet» — отдаёт подписанный .pkpass. */
  app.get<{ Params: { serial: string } }>('/cards/:serial/pass.pkpass', { config: joinLimit }, async (req, reply) => {
    if (!apple.appleEnabled()) throw notFound('apple_disabled');
    const card = await activeCard(assertUuid(req.params.serial, 'card_not_found'));
    const pkpass = await apple.generatePass(card);
    return reply
      .header('Content-Type', 'application/vnd.apple.pkpass')
      .header('Content-Disposition', 'attachment; filename="card.pkpass"')
      .header('Cache-Control', 'no-store')
      .send(pkpass);
  });

  // ───────── Картинки (их скачивают Google и браузер) ─────────

  async function programOr404(id: string) {
    const p = await prisma.loyaltyProgram.findUnique({ where: { id: assertUuid(id) } });
    if (!p) throw notFound();
    return p;
  }

  app.get<{ Params: { id: string } }>('/programs/:id/logo.png', async (req, reply) => {
    const p = await programOr404(req.params.id);
    if (!p.logoAssetId) throw notFound();
    const asset = await prisma.asset.findUnique({ where: { id: p.logoAssetId } });
    if (!asset) throw notFound();
    return sendPng(reply, Buffer.from(asset.data));
  });

  app.get<{ Params: { id: string } }>('/programs/:id/logo-square.png', async (req, reply) => {
    const p = await programOr404(req.params.id);
    const asset = p.logoAssetId ? await prisma.asset.findUnique({ where: { id: p.logoAssetId } }) : null;
    const png = await squareLogo(asset ? Buffer.from(asset.data) : null, { bg: p.bgColor, fg: p.fgColor }, 660);
    return sendPng(reply, png);
  });

  app.get<{ Params: { id: string; filled: string } }>('/programs/:id/strip/:filled.png', async (req, reply) => {
    const p = await programOr404(req.params.id);
    const filled = Number(req.params.filled);
    if (!Number.isInteger(filled) || filled < 0 || filled > p.stampsRequired) throw notFound();
    return sendPng(reply, await stripPng(p, filled, p.stampsRequired, 3));
  });
};
