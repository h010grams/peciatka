import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { AppError, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { generatePass } from '../../services/wallet/apple.js';
import { loadWalletCard } from '../../services/walletCard.js';

/**
 * Apple PassKit Web Service (https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes).
 * webServiceURL в pass.json = {APP_URL}/api/wallet/apple, Apple дописывает /v1/…
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const unauthorized = () => new AppError(401, 'unauthorized');

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Проверяет «Authorization: ApplePass <token>» для карты с данным serial. */
async function authorizedCard(req: FastifyRequest, passTypeId: string, serial: string) {
  if (passTypeId !== config.apple?.passTypeId || !UUID_RE.test(serial)) throw unauthorized();
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('ApplePass ') ? header.slice('ApplePass '.length) : '';
  const card = await prisma.card.findUnique({
    where: { serialNumber: serial },
    select: { id: true, appleAuthToken: true, walletUpdatedAt: true },
  });
  if (!card || !token || !safeEqual(token, card.appleAuthToken)) throw unauthorized();
  return card;
}

type RegParams = { deviceId: string; passTypeId: string; serial: string };

export const appleWebServiceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async () => {
    if (!config.apple) throw notFound('apple_disabled');
  });

  // Регистрация устройства для обновлений карты
  app.post<{ Params: RegParams; Body: { pushToken?: string } }>(
    '/v1/devices/:deviceId/registrations/:passTypeId/:serial',
    async (req, reply) => {
      const card = await authorizedCard(req, req.params.passTypeId, req.params.serial);
      const pushToken = req.body?.pushToken;
      if (!pushToken) return reply.code(400).send();

      const device = await prisma.appleDevice.upsert({
        where: { deviceLibraryId: req.params.deviceId },
        create: { deviceLibraryId: req.params.deviceId, pushToken },
        update: { pushToken },
      });
      const existing = await prisma.walletDeviceRegistration.findUnique({
        where: { deviceId_cardId: { deviceId: device.id, cardId: card.id } },
      });
      if (existing) return reply.code(200).send();
      await prisma.walletDeviceRegistration.create({ data: { deviceId: device.id, cardId: card.id } });
      return reply.code(201).send();
    },
  );

  // Карту удалили с устройства
  app.delete<{ Params: RegParams }>('/v1/devices/:deviceId/registrations/:passTypeId/:serial', async (req, reply) => {
    const card = await authorizedCard(req, req.params.passTypeId, req.params.serial);
    const device = await prisma.appleDevice.findUnique({ where: { deviceLibraryId: req.params.deviceId } });
    if (device) {
      await prisma.walletDeviceRegistration.deleteMany({ where: { deviceId: device.id, cardId: card.id } });
      const left = await prisma.walletDeviceRegistration.count({ where: { deviceId: device.id } });
      if (left === 0) await prisma.appleDevice.delete({ where: { id: device.id } }).catch(() => {});
    }
    return reply.code(200).send();
  });

  // Какие карты на устройстве изменились с прошлого раза (тег = время в мс)
  app.get<{ Params: { deviceId: string; passTypeId: string }; Querystring: { passesUpdatedSince?: string } }>(
    '/v1/devices/:deviceId/registrations/:passTypeId',
    async (req, reply) => {
      if (req.params.passTypeId !== config.apple?.passTypeId) return reply.code(404).send();
      const since = Number(req.query.passesUpdatedSince);
      const regs = await prisma.walletDeviceRegistration.findMany({
        where: {
          device: { deviceLibraryId: req.params.deviceId },
          ...(Number.isFinite(since) && since > 0 ? { card: { walletUpdatedAt: { gt: new Date(since) } } } : {}),
        },
        include: { card: { select: { serialNumber: true, walletUpdatedAt: true } } },
      });
      if (regs.length === 0) return reply.code(204).send();
      const lastUpdated = Math.max(...regs.map((r) => r.card.walletUpdatedAt.getTime()));
      return { serialNumbers: regs.map((r) => r.card.serialNumber), lastUpdated: String(lastUpdated) };
    },
  );

  // Свежая версия карты
  app.get<{ Params: { passTypeId: string; serial: string } }>('/v1/passes/:passTypeId/:serial', async (req, reply) => {
    const auth = await authorizedCard(req, req.params.passTypeId, req.params.serial);
    // HTTP-даты с точностью до секунды
    const lastModified = new Date(Math.floor(auth.walletUpdatedAt.getTime() / 1000) * 1000);
    const ims = req.headers['if-modified-since'];
    if (ims && !Number.isNaN(Date.parse(ims)) && lastModified.getTime() <= Date.parse(ims)) {
      return reply.code(304).send();
    }
    const card = await loadWalletCard({ id: auth.id });
    const pkpass = await generatePass(card!); // аннулированная карта тоже отдаётся — Wallet покажет «недействительна»
    return reply
      .header('Content-Type', 'application/vnd.apple.pkpass')
      .header('Last-Modified', lastModified.toUTCString())
      .send(pkpass);
  });

  // Wallet присылает сюда ошибки (например, неверная подпись) — полезно при отладке
  app.post<{ Body: { logs?: string[] } }>('/v1/log', async (req, reply) => {
    for (const line of req.body?.logs ?? []) req.log.warn({ apple: line }, 'PassKit log');
    return reply.code(200).send();
  });
};
