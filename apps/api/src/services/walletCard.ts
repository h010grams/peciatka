import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/** Всё, что нужно для отрисовки карты в Apple/Google Wallet и на веб-странице. */
export function loadWalletCard(where: Prisma.CardWhereUniqueInput) {
  return prisma.card.findUnique({
    where,
    include: {
      customer: true,
      salon: true,
      program: true,
      appointments: {
        where: { cancelledAt: null, startsAt: { gt: new Date() } },
        orderBy: { startsAt: 'asc' },
        take: 1,
      },
    },
  });
}

export type WalletCard = NonNullable<Awaited<ReturnType<typeof loadWalletCard>>>;

/** Версия картинок: меняется при смене дизайна → Google/Apple перекачают их. */
export function assetVersion(card: WalletCard) {
  return card.program.designVersion;
}
