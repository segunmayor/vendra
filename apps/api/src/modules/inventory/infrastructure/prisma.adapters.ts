import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { AuditEntry, ConcurrencyConflict } from '../../../shared-kernel';
import {
  DuplicateMovement,
  Movement,
  StockRepository,
  StockView,
  WarehouseAddress,
  WarehouseRepository,
  WarehouseView,
} from '../application/inventory';
import { StockItem } from '../domain/stock-item';

export class PrismaWarehouseRepository implements WarehouseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(sellerId: string): Promise<WarehouseView[]> {
    const rows = await this.prisma.warehouse.findMany({ where: { sellerId }, orderBy: { name: 'asc' } });
    return rows.map((row) => ({ ...row, address: row.address as unknown as WarehouseAddress }));
  }

  async findById(id: string): Promise<WarehouseView | null> {
    const row = await this.prisma.warehouse.findUnique({ where: { id } });
    return row ? { ...row, address: row.address as unknown as WarehouseAddress } : null;
  }

  async create(warehouse: WarehouseView, audit: AuditEntry): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.warehouse.create({ data: { ...warehouse, address: warehouse.address as unknown as Prisma.InputJsonObject } });
      await appendAudit(tx, audit);
    });
  }
}

export class PrismaStockRepository implements StockRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(listingId: string, warehouseId: string): Promise<StockItem | null> {
    const row = await this.prisma.stockItem.findUnique({ where: { listingId_warehouseId: { listingId, warehouseId } } });
    return row ? StockItem.rehydrate(row) : null;
  }

  async findMovementSource(sourceType: string, sourceId: string): Promise<{ listingId: string; warehouseId: string } | null> {
    const row = await this.prisma.stockMovement.findFirst({
      where: { sourceType, sourceId },
      select: { stockItem: { select: { listingId: true, warehouseId: true } } },
    });
    return row?.stockItem ?? null;
  }

  /**
   * Holds past their expiry count as free here, even before the sweep or the next
   * reservation releases them, so customers never see stock that is no longer held as gone.
   */
  async listByListings(listingIds: readonly string[]): Promise<StockView[]> {
    if (listingIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ listingId: string; warehouseId: string; onHand: number; reserved: number; lapsed: number }[]>`
      SELECT s."listingId", s."warehouseId", s."onHand", s."reserved",
             COALESCE(SUM(r."quantity") FILTER (WHERE r."status" = 'held' AND r."expiresAt" <= now()), 0)::int AS "lapsed"
      FROM "inventory"."stock_items" s
      LEFT JOIN "inventory"."stock_reservations" r ON r."stockItemId" = s."id"
      WHERE s."listingId" = ANY(${[...listingIds]}::uuid[])
      GROUP BY s."id"`;
    return rows.map((row) => {
      const reserved = row.reserved - row.lapsed;
      return { listingId: row.listingId, warehouseId: row.warehouseId, onHand: row.onHand, reserved, available: row.onHand - reserved };
    });
  }

  async save(item: StockItem, movement: Movement, audit: AuditEntry): Promise<void> {
    const state = item.snapshot;
    const events = item.pullEvents();
    try {
      await this.prisma.$transaction(async (tx) => {
        if (state.version === 0) {
          await tx.stockItem.create({ data: { ...state, version: 1 } });
        } else {
          const { count } = await tx.stockItem.updateMany({
            where: { id: state.id, version: state.version },
            data: { onHand: state.onHand, reserved: state.reserved, version: { increment: 1 } },
          });
          if (count !== 1) throw new ConcurrencyConflict('StockItem', state.id);
        }
        await tx.stockMovement.create({ data: { ...movement, stockItemId: state.id } });
        await appendAudit(tx, audit);
        await appendToOutbox(tx, events);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta as { target?: unknown } | undefined)?.target ?? '');
        if (target.includes('sourceId')) throw new DuplicateMovement();
        throw new ConcurrencyConflict('StockItem', state.id);
      }
      throw error;
    }
    item.markSaved();
  }
}
