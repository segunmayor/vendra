import type { Prisma } from '@prisma/client';
import { DomainEvent } from '../../shared-kernel';

/** Must be called inside the transaction that saves the aggregate. */
export async function appendToOutbox(
  tx: Prisma.TransactionClient,
  events: readonly DomainEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.outboxEvent.createMany({
    data: events.map((event) => ({
      type: event.type,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt,
      payload: event.payload as Prisma.InputJsonObject,
    })),
  });
}
