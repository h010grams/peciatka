import { createSign } from 'node:crypto';
import { JWT } from 'google-auth-library';
import type { LoyaltyProgram, Salon } from '@prisma/client';
import { config, type GoogleConfig } from '../../config.js';
import { formatDateTime, t } from '../../lib/i18n.js';
import { prisma } from '../../lib/prisma.js';
import { urls } from '../urls.js';
import type { WalletCard } from '../walletCard.js';

/**
 * Google Wallet: LoyaltyClass на программу салона, LoyaltyObject на карту клиентки.
 * Карта добавляется по ссылке «Save to Google Wallet» (подписанный JWT с объектом внутри),
 * дальше мы обновляем объект через REST API, Google сам доставляет изменения на телефон.
 */

const API = 'https://walletobjects.googleapis.com/walletobjects/v1';

export const googleEnabled = () => config.google !== null;

function cfg(): GoogleConfig {
  if (!config.google) throw new Error('Google Wallet is not configured');
  return config.google;
}

// ID в Google: только [A-Za-z0-9._-], с префиксом issuerId.
export const classIdFor = (programId: string) => `${cfg().issuerId}.p-${programId}`;
export const objectIdFor = (serial: string) => `${cfg().issuerId}.c-${serial}`;

let client: JWT | null = null;
function http() {
  client ??= new JWT({
    email: cfg().clientEmail,
    key: cfg().privateKey,
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  return client;
}

async function call(method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const res = await http().request({ url: `${API}${path}`, method, data, validateStatus: () => true });
  return { status: res.status, data: res.data as Record<string, unknown> };
}

// ───────── Построение объектов ─────────

export function buildClass(program: LoyaltyProgram, salon: Salon) {
  return {
    id: classIdFor(program.id),
    issuerName: salon.name,
    programName: program.name,
    programLogo: {
      sourceUri: { uri: urls.logoSquare(program.id, program.designVersion) },
      contentDescription: { defaultValue: { language: salon.defaultLocale, value: salon.name } },
    },
    hexBackgroundColor: program.bgColor,
    countryCode: 'SK',
    reviewStatus: 'UNDER_REVIEW',
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
    // По умолчанию Google показывает текстовые модули только в деталях карты.
    // Шаблон выносит «Награду» и «Следующий визит» на лицевую сторону; если записи нет — ячейка пустая.
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            twoItems: {
              startItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['reward']" }] } },
              endItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['next']" }] } },
            },
          },
        ],
      },
    },
  };
}

export function buildObject(card: WalletCard) {
  const { program, customer, salon } = card;
  const loc = customer.locale;
  const next = card.appointments[0];
  const textModules = [
    { id: 'reward', header: t(loc, 'reward_label', { n: program.stampsRequired }), body: program.rewardText },
    ...(next
      ? [{ id: 'next', header: t(loc, 'next_visit'), body: formatDateTime(next.startsAt, loc, salon.timezone) }]
      : []),
  ];
  return {
    id: objectIdFor(card.serialNumber),
    classId: classIdFor(program.id),
    state: card.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    accountId: card.serialNumber.slice(0, 8).toUpperCase(),
    accountName: customer.name,
    loyaltyPoints: {
      label: t(loc, 'stamps'),
      balance: { string: `${card.stampCount} / ${program.stampsRequired}` },
    },
    ...(card.rewardsAvailable > 0
      ? { secondaryLoyaltyPoints: { label: t(loc, 'available'), balance: { int: card.rewardsAvailable } } }
      : {}),
    barcode: { type: 'QR_CODE', value: card.qrToken },
    heroImage: {
      sourceUri: { uri: urls.strip(program.id, card.stampCount, program.designVersion) },
    },
    hexBackgroundColor: program.bgColor,
    textModulesData: textModules,
    linksModuleData: { uris: [{ id: 'card', uri: urls.cardPage(card.serialNumber), description: salon.name }] },
  };
}

// ───────── JWT для кнопки «Save to Google Wallet» ─────────

function signRs256(payload: object, privateKey: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

export async function saveUrl(card: WalletCard): Promise<string> {
  await ensureClass(card.program, card.salon);
  if (!card.googleObjectId) {
    await prisma.card.update({ where: { id: card.id }, data: { googleObjectId: objectIdFor(card.serialNumber) } });
  }
  const jwt = signRs256(
    {
      iss: cfg().clientEmail,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: [new URL(config.APP_URL).origin],
      payload: { loyaltyObjects: [buildObject(card)] },
    },
    cfg().privateKey,
  );
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

// ───────── REST ─────────

/** Создаёт или обновляет класс программы (название, логотип, цвет). */
export async function ensureClass(program: LoyaltyProgram, salon: Salon) {
  const body = buildClass(program, salon);
  const existing = await call('GET', `/loyaltyClass/${body.id}`);
  const res =
    existing.status === 404
      ? await call('POST', '/loyaltyClass', body)
      : await call('PUT', `/loyaltyClass/${body.id}`, body);
  if (res.status >= 300) throw new Error(`Google class ${res.status}: ${JSON.stringify(res.data)}`);
  if (program.googleClassId !== body.id) {
    await prisma.loyaltyProgram.update({ where: { id: program.id }, data: { googleClassId: body.id } });
  }
}

/**
 * Обновляет объект карты. Если клиентка ещё не сохранила карту — объекта нет (404),
 * это нормально: при сохранении в JWT уйдёт актуальное состояние.
 */
export async function syncObject(card: WalletCard, notify: string | null) {
  if (!card.googleObjectId) return;
  const body = buildObject(card);
  const res = await call('PUT', `/loyaltyObject/${body.id}`, body);
  if (res.status === 404) return;
  if (res.status >= 300) throw new Error(`Google object ${res.status}: ${JSON.stringify(res.data)}`);

  if (notify) {
    // TEXT_AND_NOTIFY → push-уведомление (Google ограничивает ~3 в сутки на карту)
    const msg = await call('POST', `/loyaltyObject/${body.id}/addMessage`, {
      message: {
        id: `m-${Date.now()}`,
        header: card.salon.name,
        body: notify,
        messageType: 'TEXT_AND_NOTIFY',
      },
    });
    if (msg.status >= 300) throw new Error(`Google message ${msg.status}: ${JSON.stringify(msg.data)}`);
  }
}
