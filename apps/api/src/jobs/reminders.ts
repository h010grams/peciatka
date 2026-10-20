import { formatDateTime, t } from '../lib/i18n.js';
import { prisma } from '../lib/prisma.js';
import { enqueueWalletSync, kickWalletWorker } from '../services/wallet/sync.js';

const DAY = 24 * 3600 * 1000;

/**
 * Напоминание за сутки до записи: текст уходит в карту (поле уведомлений Apple
 * и сообщение Google) → push на телефоне. Записи, созданные меньше чем за сутки
 * до визита, не напоминаем: клиентка только что записалась.
 */
export async function processReminders(now = new Date()): Promise<number> {
  const due = await prisma.appointment.findMany({
    where: {
      cancelledAt: null,
      reminderSentAt: null,
      startsAt: { gt: now, lte: new Date(now.getTime() + DAY) },
      card: { status: 'ACTIVE' },
    },
    include: { card: { include: { customer: true, salon: true } } },
    take: 100,
  });

  let sent = 0;
  for (const appt of due) {
    const tooLate = appt.createdAt.getTime() > appt.startsAt.getTime() - DAY;
    await prisma.$transaction(async (tx) => {
      // атомарно помечаем: если два процесса запустятся одновременно, отправит один
      const { count } = await tx.appointment.updateMany({
        where: { id: appt.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (count === 0 || tooLate) return;

      const { customer, salon } = appt.card;
      const notice = t(customer.locale, 'msg_reminder', {
        salon: salon.name,
        when: formatDateTime(appt.startsAt, customer.locale, salon.timezone),
      });
      await tx.card.update({
        where: { id: appt.cardId },
        data: { walletNotice: notice, walletUpdatedAt: now },
      });
      await enqueueWalletSync(tx, appt.cardId, notice);
      sent++;
    });
  }
  if (sent) kickWalletWorker();
  return sent;
}

let timer: NodeJS.Timeout | null = null;

export function startReminderJob() {
  const run = () => processReminders().catch((e) => console.error('[reminders]', e));
  timer = setInterval(run, 60_000);
  void run();
}

export function stopReminderJob() {
  if (timer) clearInterval(timer);
  timer = null;
}
