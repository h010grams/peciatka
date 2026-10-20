import { config } from '../../config.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { loadWalletCard } from '../walletCard.js';
import * as apple from './apple.js';
import * as google from './google.js';

/**
 * Outbox синхронизации Wallet.
 * В транзакции изменения карты вызываем enqueueWalletSync(tx, …) — запись
 * появится только если транзакция прошла. Воркер забирает задачи, обновляет
 * Google-объект и шлёт push в APNs; при ошибке — повтор с экспоненциальной паузой.
 */

const MAX_ATTEMPTS = 8;

export async function enqueueWalletSync(tx: Tx, cardId: string, notify?: string | null) {
  await tx.walletSyncJob.upsert({
    where: { cardId },
    create: { cardId, notify: notify ?? null },
    update: {
      ...(notify ? { notify } : {}),
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
    },
  });
}

/** Все карты программы (после смены дизайна). */
export async function enqueueProgramSync(tx: Tx, programId: string) {
  await tx.$executeRaw`
    UPDATE "Card" SET "walletUpdatedAt" = now() WHERE "programId" = ${programId}::uuid`;
  await tx.$executeRaw`
    INSERT INTO "WalletSyncJob" (id, "cardId")
    SELECT gen_random_uuid(), id FROM "Card" WHERE "programId" = ${programId}::uuid
    ON CONFLICT ("cardId") DO UPDATE SET "nextAttemptAt" = now(), attempts = 0`;
}

export async function syncCard(cardId: string, notify: string | null) {
  const card = await loadWalletCard({ id: cardId });
  if (!card) return;

  if (google.googleEnabled()) await google.syncObject(card, notify);

  if (apple.appleEnabled()) {
    const regs = await prisma.walletDeviceRegistration.findMany({
      where: { cardId },
      include: { device: true },
    });
    const { invalid } = await apple.pushUpdate(regs.map((r) => r.device.pushToken));
    if (invalid.length) {
      await prisma.walletDeviceRegistration.deleteMany({
        where: { cardId, device: { pushToken: { in: invalid } } },
      });
    }
  }
}

/** Обрабатывает пачку готовых задач. Возвращает их количество. */
export async function processWalletJobs(limit = 20): Promise<number> {
  // DELETE … RETURNING + SKIP LOCKED: задачу заберёт ровно один обработчик
  const jobs = await prisma.$queryRaw<{ id: string; cardId: string; notify: string | null; attempts: number }[]>`
    DELETE FROM "WalletSyncJob"
    WHERE id IN (
      SELECT id FROM "WalletSyncJob"
      WHERE "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "cardId", notify, attempts`;

  for (const job of jobs) {
    try {
      await syncCard(job.cardId, job.notify);
    } catch (e) {
      const attempts = job.attempts + 1;
      const message = e instanceof Error ? e.message : String(e);
      if (attempts >= MAX_ATTEMPTS) {
        console.error(`[wallet] giving up on card ${job.cardId}: ${message}`);
        continue;
      }
      const delayMs = Math.min(30 * 60_000, 5_000 * 2 ** attempts);
      console.warn(`[wallet] sync failed for card ${job.cardId} (attempt ${attempts}): ${message}`);
      // если за это время появилась новая задача на карту — оставляем её
      await prisma.walletSyncJob.upsert({
        where: { cardId: job.cardId },
        create: {
          cardId: job.cardId,
          notify: job.notify,
          attempts,
          nextAttemptAt: new Date(Date.now() + delayMs),
          lastError: message.slice(0, 500),
        },
        update: {},
      }).catch(() => {}); // карту могли удалить
    }
  }
  return jobs.length;
}

// ───────── Цикл воркера ─────────

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    while ((await processWalletJobs()) > 0) {
      // разбираем очередь до конца
    }
  } catch (e) {
    console.error('[wallet] worker error', e);
  } finally {
    running = false;
  }
}

/** Будит воркер сразу после коммита, чтобы push ушёл без задержки. */
export function kickWalletWorker() {
  if (config.WORKERS_ENABLED && timer) setImmediate(() => void tick());
}

export function startWalletWorker() {
  timer = setInterval(() => void tick(), 5_000);
  void tick();
}

export function stopWalletWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
