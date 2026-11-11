import { AggregateRoot, DomainError } from '../../../shared-kernel';

export type AdjustmentReason = 'receipt' | 'correction' | 'damaged' | 'lost' | 'returned';
export const ADJUSTMENT_REASONS: readonly AdjustmentReason[] = ['receipt', 'correction', 'damaged', 'lost', 'returned'];

const INCREASES: readonly AdjustmentReason[] = ['receipt', 'returned'];
const DECREASES: readonly AdjustmentReason[] = ['damaged', 'lost'];
const MAX_DELTA = 1_000_000;

/** Stock of one listing in one warehouse. Reserved units are held for checkouts in progress. */
export interface StockItemState {
  readonly id: string;
  readonly listingId: string;
  readonly warehouseId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly version: number;
}

export class StockItem extends AggregateRoot {
  private constructor(private state: StockItemState) {
    super();
  }

  static open(input: { id: string; listingId: string; warehouseId: string }): StockItem {
    return new StockItem({ ...input, onHand: 0, reserved: 0, version: 0 });
  }

  static rehydrate(state: StockItemState): StockItem {
    return new StockItem(state);
  }

  get snapshot(): StockItemState {
    return this.state;
  }

  get available(): number {
    return this.state.onHand - this.state.reserved;
  }

  markSaved(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
  }

  adjust(delta: number, reason: AdjustmentReason, now: Date): void {
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_DELTA) {
      throw new DomainError('stock.invalid_quantity', `Adjust by a whole number between 1 and ${MAX_DELTA.toLocaleString('en-NG')}`);
    }
    if (INCREASES.includes(reason) && delta < 0) {
      throw new DomainError('stock.reason_mismatch', `A ${reason} must increase stock`);
    }
    if (DECREASES.includes(reason) && delta > 0) {
      throw new DomainError('stock.reason_mismatch', `${reason === 'lost' ? 'Lost' : 'Damaged'} stock must decrease stock`);
    }
    const onHand = this.state.onHand + delta;
    if (onHand < this.state.reserved) {
      throw new DomainError(
        'stock.insufficient',
        `Only ${this.available} units are free to remove; ${this.state.reserved} are reserved for checkouts`,
      );
    }
    this.state = { ...this.state, onHand };
    this.raise({
      type: 'StockAdjusted',
      aggregateId: this.state.id,
      occurredAt: now,
      payload: { listingId: this.state.listingId, warehouseId: this.state.warehouseId, delta, reason, onHand, available: this.available },
    });
  }
}
