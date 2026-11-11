import type { PrismaClient } from '@prisma/client';

export interface OutboxMessage {
  readonly id: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

export type OutboxHandler = (message: OutboxMessage) => Promise<void>;

export const MAX_OUTBOX_ATTEMPTS = 10;

/**
 * Delivers committed events at least once. Handlers must therefore be idempotent,
 * and must not rely on order, since a failed event is retried after later ones.
 * Types with no handler stay unpublished, so a consumer added later still sees them.
 */
export class OutboxRelay {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly handlers: Readonly<Record<string, readonly OutboxHandler[]>>,
    private readonly batchSize = 50,
  ) {}

  async runOnce(): Promise<{ published: number; failed: number }> {
    const types = Object.keys(this.handlers);
    const seen: string[] = [];
    let published = 0;
    let failed = 0;

    while (seen.length < this.batchSize) {
      let claimedId: string | null = null;
      try {
        const delivered = await this.prisma.$transaction(
          async (tx) => {
            // SKIP LOCKED lets several relays run without delivering the same event twice.
            const rows = await tx.$queryRaw<OutboxMessage[]>`
              SELECT "id", "type", "aggregateId", "payload", "occurredAt"
              FROM "platform"."outbox_events"
              WHERE "publishedAt" IS NULL
                AND "attempts" < ${MAX_OUTBOX_ATTEMPTS}
                AND "type" = ANY(${types}::text[])
                AND NOT ("id" = ANY(${seen}::uuid[]))
              ORDER BY "occurredAt"
              LIMIT 1
              FOR UPDATE SKIP LOCKED`;
            const message = rows[0];
            if (!message) return false;

            claimedId = message.id;
            seen.push(message.id);
            for (const handler of this.handlers[message.type] ?? []) await handler(message);
            await tx.outboxEvent.update({
              where: { id: message.id },
              data: { publishedAt: new Date() },
            });
            return true;
          },
          { timeout: 30_000 },
        );
        if (!delivered) break;
        published += 1;
      } catch (error) {
        if (claimedId === null) throw error;
        failed += 1;
        await this.prisma.outboxEvent.update({
          where: { id: claimedId },
          data: {
            attempts: { increment: 1 },
            lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error),
          },
        });
      }
    }
    return { published, failed };
  }
}
