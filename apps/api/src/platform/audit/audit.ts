import type { Prisma } from '@prisma/client';
import { AuditEntry } from '../../shared-kernel';

/** Call inside the transaction making the change, so the two commit together. */
export async function appendAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before as Prisma.InputJsonObject | undefined,
      after: entry.after as Prisma.InputJsonObject | undefined,
      ipAddress: entry.ipAddress,
    },
  });
}
