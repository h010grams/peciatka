import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { CONSENT_VERSION, type joinSchema } from '@peciatka/shared';
import type { z } from 'zod';
import { audit } from '../lib/audit.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { addStamp } from './cards.js';

export type JoinInput = z.output<typeof joinSchema>;

/** Телефон в E.164; по умолчанию считаем номер словацким (0905… → +421905…). */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const p = parsePhoneNumberFromString(raw, 'SK');
  if (!p || !p.isValid()) throw badRequest('phone_invalid');
  return p.number;
}

/**
 * Регистрация клиентки — по QR-постеру (source=poster, actor=null) или на кассе (source=counter).
 * Та же клиентка (по телефону, затем по email) получает ту же карту, без дубликатов.
 * Новая карта сразу получает первый штамп, если это включено в программе.
 */
export async function registerCustomer(
  salonId: string,
  input: JoinInput,
  opts: { actorUserId: string | null; source: 'poster' | 'counter' },
): Promise<{ cardId: string; serial: string; created: boolean; firstStamp: boolean }> {
  const program = await prisma.loyaltyProgram.findUnique({ where: { salonId } });
  if (!program || !program.isActive) throw notFound('program_missing');

  const phone = normalizePhone(input.phone);
  const email = input.email || null;

  const result = await prisma.$transaction(async (tx) => {
    const existing =
      (phone && (await tx.customer.findUnique({ where: { salonId_phoneE164: { salonId, phoneE164: phone } } }))) ||
      (email && (await tx.customer.findUnique({ where: { salonId_email: { salonId, email } } }))) ||
      null;

    let customerId: string;
    if (existing) {
      customerId = existing.id;
      // дополняем недостающий контакт, если он не занят другой клиенткой
      const addPhone =
        phone && !existing.phoneE164
          ? !(await tx.customer.findUnique({ where: { salonId_phoneE164: { salonId, phoneE164: phone } } }))
          : false;
      const addEmail =
        email && !existing.email ? !(await tx.customer.findUnique({ where: { salonId_email: { salonId, email } } })) : false;
      await tx.customer.update({
        where: { id: existing.id },
        data: {
          consentAt: new Date(),
          consentVersion: CONSENT_VERSION,
          locale: input.locale,
          ...(addPhone ? { phoneE164: phone } : {}),
          ...(addEmail ? { email } : {}),
        },
      });
    } else {
      const created = await tx.customer.create({
        data: {
          salonId,
          name: input.name,
          phoneE164: phone,
          email,
          locale: input.locale,
          consentAt: new Date(),
          consentVersion: CONSENT_VERSION,
        },
      });
      customerId = created.id;
      await audit(tx, {
        salonId,
        actorUserId: opts.actorUserId,
        action: 'customer.join',
        entityType: 'customer',
        entityId: customerId,
        payload: { source: opts.source },
      });
    }

    const before = await tx.card.findUnique({
      where: { customerId_programId: { customerId, programId: program.id } },
      select: { id: true, serialNumber: true },
    });
    if (before) return { cardId: before.id, serial: before.serialNumber, created: false };

    const card = await tx.card.create({
      data: {
        salonId,
        programId: program.id,
        customerId,
        qrToken: randomToken(18),
        appleAuthToken: randomToken(24),
      },
    });
    return { cardId: card.id, serial: card.serialNumber, created: true };
  });

  // Первый штамп — отдельной транзакцией, через те же правила, что и обычный штамп
  let firstStamp = false;
  if (result.created && program.firstStampOnJoin) {
    await addStamp(salonId, result.cardId, opts.actorUserId);
    firstStamp = true;
  }
  return { ...result, firstStamp };
}
