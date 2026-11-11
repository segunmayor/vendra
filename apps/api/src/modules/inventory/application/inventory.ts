import { ListingQueries } from '../../listings';
import { ApplicationError, AuditEntry, ConcurrencyConflict, DomainError, FIRST_PARTY_SELLER_ID, Principal } from '../../../shared-kernel';
import { AdjustmentReason, StockItem } from '../domain/stock-item';

export { ADJUSTMENT_REASONS } from '../domain/stock-item';
export type { AdjustmentReason } from '../domain/stock-item';

export interface WarehouseAddress {
  readonly line1: string;
  readonly city: string;
  readonly state: string;
}

export interface WarehouseView {
  readonly id: string;
  readonly sellerId: string;
  readonly name: string;
  readonly address: WarehouseAddress;
}

export interface StockView {
  readonly listingId: string;
  readonly warehouseId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
}

export interface Movement {
  readonly delta: number;
  readonly reason: AdjustmentReason;
  readonly sourceType: string;
  readonly sourceId: string;
}

/** Thrown when a movement with the same source already exists. */
export class DuplicateMovement extends Error {}

export interface WarehouseRepository {
  list(sellerId: string): Promise<WarehouseView[]>;
  findById(id: string): Promise<WarehouseView | null>;
  create(warehouse: WarehouseView, audit: AuditEntry): Promise<void>;
}

export interface StockRepository {
  find(listingId: string, warehouseId: string): Promise<StockItem | null>;
  findMovementSource(sourceType: string, sourceId: string): Promise<{ listingId: string; warehouseId: string } | null>;
  /** Commits stock, movement, audit and events together. Throws ConcurrencyConflict or DuplicateMovement. */
  save(item: StockItem, movement: Movement, audit: AuditEntry): Promise<void>;
  listByListings(listingIds: readonly string[]): Promise<StockView[]>;
}

const MANUAL = 'manual_adjustment';
const notFound = (what: string) => new ApplicationError('not_found', `${what}.not_found`, `${what[0]?.toUpperCase()}${what.slice(1)} not found`);
const toView = (item: StockItem): StockView => ({
  listingId: item.snapshot.listingId,
  warehouseId: item.snapshot.warehouseId,
  onHand: item.snapshot.onHand,
  reserved: item.snapshot.reserved,
  available: item.available,
});

export class InventoryService {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly stock: StockRepository,
    private readonly listings: ListingQueries,
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
  ) {}

  listWarehouses(): Promise<WarehouseView[]> {
    return this.warehouses.list(FIRST_PARTY_SELLER_ID);
  }

  async createWarehouse(actor: Principal, input: { name: string; address: WarehouseAddress }): Promise<WarehouseView> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 100) throw new DomainError('warehouse.invalid_name', 'Names must be 2 to 100 characters');
    const warehouse: WarehouseView = { id: this.ids.uuid(), sellerId: FIRST_PARTY_SELLER_ID, name, address: input.address };
    await this.warehouses.create(warehouse, {
      actorId: actor.accountId,
      action: 'inventory.warehouse_created',
      targetType: 'warehouse',
      targetId: warehouse.id,
      after: { ...warehouse },
    });
    return warehouse;
  }

  async stockForProduct(productId: string): Promise<StockView[]> {
    const listingIds = await this.listings.listingIdsOfProduct(productId);
    if (!listingIds) throw notFound('product');
    return this.stock.listByListings(listingIds);
  }

  /** Safe to retry: the same idempotency key never applies twice. */
  async adjust(
    actor: Principal,
    input: { listingId: string; warehouseId: string; delta: number; reason: AdjustmentReason; idempotencyKey: string },
  ): Promise<StockView> {
    const replay = await this.replay(input);
    if (replay) return replay;

    const listing = await this.listings.getListing(input.listingId);
    if (!listing) throw notFound('listing');
    const warehouse = await this.warehouses.findById(input.warehouseId);
    if (!warehouse) throw notFound('warehouse');
    if (warehouse.sellerId !== listing.sellerId) {
      throw new DomainError('stock.wrong_warehouse', "Stock must be held in the seller's own warehouse");
    }

    const item =
      (await this.stock.find(input.listingId, input.warehouseId)) ??
      StockItem.open({ id: this.ids.uuid(), listingId: input.listingId, warehouseId: input.warehouseId });
    const before = item.snapshot.onHand;
    item.adjust(input.delta, input.reason, this.clock.now());

    try {
      await this.stock.save(
        item,
        { delta: input.delta, reason: input.reason, sourceType: MANUAL, sourceId: input.idempotencyKey },
        {
          actorId: actor.accountId,
          action: 'inventory.stock_adjusted',
          targetType: 'stock_item',
          targetId: item.snapshot.id,
          before: { onHand: before },
          after: { onHand: item.snapshot.onHand, delta: input.delta, reason: input.reason },
        },
      );
    } catch (error) {
      // A concurrent request with the same key may have won. If so, report its result.
      if (error instanceof DuplicateMovement || error instanceof ConcurrencyConflict) {
        const replayed = await this.replay(input);
        if (replayed) return replayed;
      }
      throw error;
    }
    return toView(item);
  }

  private async replay(input: { listingId: string; warehouseId: string; idempotencyKey: string }): Promise<StockView | null> {
    const prior = await this.stock.findMovementSource(MANUAL, input.idempotencyKey);
    if (!prior) return null;
    if (prior.listingId !== input.listingId || prior.warehouseId !== input.warehouseId) {
      throw new ApplicationError('conflict', 'idempotency.key_reused', 'This Idempotency-Key was already used for a different request');
    }
    const item = await this.stock.find(input.listingId, input.warehouseId);
    return item ? toView(item) : null;
  }
}
