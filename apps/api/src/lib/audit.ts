import type { Prisma } from '@prisma/client';
import type { Tx } from './prisma.js';

export interface AuditEntry {
  salonId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payload?: Prisma.InputJsonValue;
}

/** Пишется в той же транзакции, что и само действие: нет действия без записи в журнале. */
export function audit(tx: Tx, entry: AuditEntry) {
  return tx.auditLog.create({ data: entry });
}
