import { Prisma, type PrismaClient } from '@prisma/client';
import type { HeldReservation, ReservationStore } from '../application/reservations';
import type { Allocation, StockRow } from '../domain/reservation';

type Tx = Prisma.TransactionClient;

/** Only one API instance sweeps at a time; the others skip that round. */
const SWEEP_LOCK = 72_041_118;

interface Released {
  stockItemId: string;
  quantity: number;
}

/** Gives reserved units back to their stock items. Caller must already hold the stock row locks. */
async function giveBack(tx: Tx, released: readonly Released[]): Promise<void> {
  const totals = new Map<string, number>();
  for (const row of released) totals.set(row.stockItemId, (totals.get(row.stockItemId) ?? 0) + row.quantity);
  for (const [id, quantity] of totals) {
    await tx.$executeRaw`
      UPDATE "inventory"."stock_items" SET "reserved" = "reserved" - ${quantity}, "version" = "version" + 1 WHERE "id" = ${id}::uuid`;
  }
}

/** Locks stock rows in id order, the single lock order used everywhere. */
async function lockStock(tx: Tx, where: Prisma.Sql) {
  return tx.$queryRaw<{ id: string; listingId: string; onHand: number; reserved: number }[]>`
    SELECT "id", "listingId", "onHand", "reserved" FROM "inventory"."stock_items" WHERE ${where} ORDER BY "id" FOR UPDATE`;
}

export class PrismaReservationStore implements ReservationStore {
  constructor(private readonly prisma: PrismaClient) {}

  async reserve(
    checkoutId: string,
    listingIds: readonly string[],
    now: Date,
    expiresAt: Date,
    decide: (stock: readonly StockRow[]) => Allocation[],
  ): Promise<{ created: boolean; held: HeldReservation[] }> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockStock(tx, Prisma.sql`"listingId" = ANY(${[...listingIds]}::uuid[])`);
      const ids = locked.map((row) => row.id);

      // A retry of the same checkout must not reserve twice. Checked after locking, so two
      // concurrent retries are serialised and the second sees the first one's holds.
      const existing = await this.heldIn(tx, checkoutId);
      if (existing.length > 0) return { created: false, held: existing };

      // Lapsed holds on these rows are freed first, so stock never waits for the sweep.
      if (ids.length > 0) {
        const lapsed = await tx.$queryRaw<Released[]>`
          UPDATE "inventory"."stock_reservations" SET "status" = 'expired'
          WHERE "stockItemId" = ANY(${ids}::uuid[]) AND "status" = 'held' AND "expiresAt" <= ${now}
          RETURNING "stockItemId", "quantity"`;
        await giveBack(tx, lapsed);
        const freed = new Map<string, number>();
        for (const row of lapsed) freed.set(row.stockItemId, (freed.get(row.stockItemId) ?? 0) + row.quantity);
        for (const row of locked) row.reserved -= freed.get(row.id) ?? 0;
      }

      const allocations = decide(locked.map((row) => ({ stockItemId: row.id, listingId: row.listingId, available: row.onHand - row.reserved })));
      for (const allocation of allocations) {
        await tx.$executeRaw`
          UPDATE "inventory"."stock_items" SET "reserved" = "reserved" + ${allocation.quantity}, "version" = "version" + 1
          WHERE "id" = ${allocation.stockItemId}::uuid`;
      }
      // A checkout reserving again (for example a late payment after its hold lapsed) revives
      // its old released or expired rows rather than adding duplicates. Committed rows are never revived.
      for (const allocation of allocations) {
        const revived = await tx.$executeRaw`
          INSERT INTO "inventory"."stock_reservations" ("id", "stockItemId", "checkoutId", "quantity", "status", "expiresAt")
          VALUES (gen_random_uuid(), ${allocation.stockItemId}::uuid, ${checkoutId}::uuid, ${allocation.quantity}, 'held', ${expiresAt})
          ON CONFLICT ("checkoutId", "stockItemId") DO UPDATE
            SET "status" = 'held', "quantity" = EXCLUDED."quantity", "expiresAt" = EXCLUDED."expiresAt", "createdAt" = now()
            WHERE "inventory"."stock_reservations"."status" IN ('released', 'expired')`;
        if (revived !== 1) throw new Error(`Reservation for checkout ${checkoutId} is already committed`);
      }
      return { created: true, held: await this.heldIn(tx, checkoutId) };
    });
  }

  async release(checkoutId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const items = await tx.stockReservation.findMany({ where: { checkoutId, status: 'held' }, select: { stockItemId: true } });
      if (items.length === 0) return 0;
      await lockStock(tx, Prisma.sql`"id" = ANY(${items.map((item) => item.stockItemId)}::uuid[])`);
      const released = await tx.$queryRaw<Released[]>`
        UPDATE "inventory"."stock_reservations" SET "status" = 'released'
        WHERE "checkoutId" = ${checkoutId}::uuid AND "status" = 'held'
        RETURNING "stockItemId", "quantity"`;
      await giveBack(tx, released);
      return released.length;
    });
  }

  async commit(checkoutId: string, now: Date): Promise<HeldReservation[]> {
    return this.prisma.$transaction(async (tx) => {
      const items = await tx.stockReservation.findMany({ where: { checkoutId, status: 'held' }, select: { stockItemId: true } });
      if (items.length === 0) return [];
      await lockStock(tx, Prisma.sql`"id" = ANY(${items.map((item) => item.stockItemId)}::uuid[])`);
      const committed = await tx.$queryRaw<(Released & { listingId: string; expiresAt: Date })[]>`
        UPDATE "inventory"."stock_reservations" r SET "status" = 'committed'
        FROM "inventory"."stock_items" s
        WHERE r."checkoutId" = ${checkoutId}::uuid AND r."status" = 'held' AND s."id" = r."stockItemId"
        RETURNING r."stockItemId", r."quantity", s."listingId", r."expiresAt"`;
      for (const row of committed) {
        await tx.$executeRaw`
          UPDATE "inventory"."stock_items"
          SET "onHand" = "onHand" - ${row.quantity}, "reserved" = "reserved" - ${row.quantity}, "version" = "version" + 1
          WHERE "id" = ${row.stockItemId}::uuid`;
        await tx.stockMovement.create({
          data: { stockItemId: row.stockItemId, delta: -row.quantity, reason: 'sale', sourceType: 'checkout', sourceId: checkoutId, createdAt: now },
        });
      }
      const byListing = new Map<string, HeldReservation>();
      for (const row of committed) {
        const current = byListing.get(row.listingId);
        byListing.set(row.listingId, { listingId: row.listingId, quantity: (current?.quantity ?? 0) + row.quantity, expiresAt: row.expiresAt });
      }
      return [...byListing.values()];
    });
  }

  async releaseExpired(now: Date, limit: number): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK}) AS acquired`;
      if (!lock?.acquired) return 0;
      const due = await tx.$queryRaw<{ id: string; stockItemId: string }[]>`
        SELECT "id", "stockItemId" FROM "inventory"."stock_reservations"
        WHERE "status" = 'held' AND "expiresAt" <= ${now} ORDER BY "expiresAt" LIMIT ${limit}`;
      if (due.length === 0) return 0;
      await lockStock(tx, Prisma.sql`"id" = ANY(${[...new Set(due.map((row) => row.stockItemId))]}::uuid[])`);
      // Re-checked under the lock: a checkout may have released these meanwhile.
      const expired = await tx.$queryRaw<Released[]>`
        UPDATE "inventory"."stock_reservations" SET "status" = 'expired'
        WHERE "id" = ANY(${due.map((row) => row.id)}::uuid[]) AND "status" = 'held'
        RETURNING "stockItemId", "quantity"`;
      await giveBack(tx, expired);
      return expired.length;
    });
  }

  async hasCommitted(checkoutId: string): Promise<boolean> {
    return (await this.prisma.stockReservation.count({ where: { checkoutId, status: 'committed' } })) > 0;
  }

  held(checkoutId: string): Promise<HeldReservation[]> {
    return this.heldIn(this.prisma, checkoutId);
  }

  private async heldIn(tx: Tx | PrismaClient, checkoutId: string): Promise<HeldReservation[]> {
    const rows = await tx.stockReservation.findMany({
      where: { checkoutId, status: 'held' },
      include: { stockItem: { select: { listingId: true } } },
      orderBy: { id: 'asc' },
    });
    const byListing = new Map<string, HeldReservation>();
    for (const row of rows) {
      const current = byListing.get(row.stockItem.listingId);
      byListing.set(row.stockItem.listingId, {
        listingId: row.stockItem.listingId,
        quantity: (current?.quantity ?? 0) + row.quantity,
        expiresAt: row.expiresAt,
      });
    }
    return [...byListing.values()];
  }
}
