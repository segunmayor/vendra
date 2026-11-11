import { ApplicationError } from '../../../shared-kernel';
import { Allocation, allocate, normalizeLines, RequestedLine, RESERVATION_MINUTES, Shortfall, StockRow } from '../domain/reservation';

export { MAX_UNITS_PER_LISTING, RESERVATION_MINUTES } from '../domain/reservation';
export type { RequestedLine, Shortfall } from '../domain/reservation';

export interface HeldReservation {
  readonly listingId: string;
  readonly quantity: number;
  readonly expiresAt: Date;
}

/**
 * Persistence for reservations. Every method runs in one transaction and locks the stock
 * rows it touches, always stock items first and in id order, so concurrent calls cannot
 * deadlock or oversell. The database also refuses reserved > onHand.
 */
export interface ReservationStore {
  /** Locks stock rows for these listings, first expiring any lapsed holds on them, then calls decide. */
  reserve(
    checkoutId: string,
    listingIds: readonly string[],
    now: Date,
    expiresAt: Date,
    decide: (stock: readonly StockRow[]) => Allocation[],
  ): Promise<{ created: boolean; held: HeldReservation[] }>;
  release(checkoutId: string): Promise<number>;
  releaseExpired(now: Date, limit: number): Promise<number>;
  held(checkoutId: string): Promise<HeldReservation[]>;
}

/** Thrown inside the store's transaction so it rolls back; carries the shortfalls out. */
export class InsufficientStock extends ApplicationError {
  constructor(readonly shortfalls: readonly Shortfall[]) {
    super(
      'conflict',
      'stock.insufficient',
      shortfalls.length === 1
        ? `Only ${shortfalls[0]!.available} of an item in your basket ${shortfalls[0]!.available === 1 ? 'is' : 'are'} available`
        : `${shortfalls.length} items in your basket are no longer available in the quantity you chose`,
    );
  }
}

/** What other modules may ask inventory to do with stock. */
export class InventoryCommands {
  constructor(
    private readonly store: ReservationStore,
    private readonly clock: { now(): Date },
  ) {}

  /**
   * Holds stock for a checkout, all or nothing, for RESERVATION_MINUTES.
   * Calling again for the same checkout returns the existing holds and reserves nothing more.
   */
  async reserve(checkoutId: string, lines: readonly RequestedLine[], expiresAt?: Date): Promise<{ created: boolean; held: HeldReservation[] }> {
    const wanted = normalizeLines(lines);
    const now = this.clock.now();
    const until = expiresAt ?? new Date(now.getTime() + RESERVATION_MINUTES * 60_000);
    return this.store.reserve(
      checkoutId,
      wanted.map((line) => line.listingId),
      now,
      until,
      (stock) => {
        const result = allocate(wanted, stock);
        if (!result.ok) throw new InsufficientStock(result.shortfalls);
        return result.allocations;
      },
    );
  }

  /** Returns held stock to sale. Safe to call twice, or after expiry. */
  release(checkoutId: string): Promise<number> {
    return this.store.release(checkoutId);
  }

  /** Releases lapsed holds in batches. Returns the number released. */
  releaseExpired(limit = 500): Promise<number> {
    return this.store.releaseExpired(this.clock.now(), limit);
  }

  held(checkoutId: string): Promise<HeldReservation[]> {
    return this.store.held(checkoutId);
  }
}
