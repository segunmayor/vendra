import { DomainError } from '../../../shared-kernel';

/** Matches inventory's per-checkout cap, so a full cart can always be reserved. */
export const MAX_LINE_QUANTITY = 10;
export const MAX_LINES = 30;

export type CartOwner = { readonly kind: 'customer'; readonly customerId: string } | { readonly kind: 'guest'; readonly tokenHash: string };

export interface CartLine {
  readonly listingId: string;
  readonly quantity: number;
}

export interface CartState {
  readonly id: string;
  readonly owner: CartOwner;
  readonly lines: readonly CartLine[];
  readonly version: number;
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new DomainError('cart.invalid_quantity', 'Quantity must be a whole number');
  }
  if (quantity > MAX_LINE_QUANTITY) {
    throw new DomainError('cart.quantity_limit', `You can buy at most ${MAX_LINE_QUANTITY} of one item per order`);
  }
}

/** A customer's or guest's basket. Prices are never stored: they are read live when the cart is shown. */
export class Cart {
  private constructor(private state: CartState) {}

  static open(id: string, owner: CartOwner): Cart {
    return new Cart({ id, owner, lines: [], version: 0 });
  }

  static rehydrate(state: CartState): Cart {
    return new Cart(state);
  }

  get snapshot(): CartState {
    return this.state;
  }

  quantityOf(listingId: string): number {
    return this.state.lines.find((line) => line.listingId === listingId)?.quantity ?? 0;
  }

  /** Adds to any quantity already in the cart. */
  add(listingId: string, quantity: number): void {
    if (quantity < 1) throw new DomainError('cart.invalid_quantity', 'Add at least one');
    this.set(listingId, this.quantityOf(listingId) + quantity);
  }

  /** Sets a line's quantity. Zero removes the line. */
  set(listingId: string, quantity: number): void {
    assertQuantity(quantity);
    const exists = this.state.lines.some((line) => line.listingId === listingId);
    if (quantity === 0) {
      this.state = { ...this.state, lines: this.state.lines.filter((line) => line.listingId !== listingId) };
      return;
    }
    if (!exists && this.state.lines.length >= MAX_LINES) {
      throw new DomainError('cart.too_many_lines', `A basket can hold up to ${MAX_LINES} different items`);
    }
    this.state = {
      ...this.state,
      lines: exists
        ? this.state.lines.map((line) => (line.listingId === listingId ? { listingId, quantity } : line))
        : [...this.state.lines, { listingId, quantity }],
    };
  }

  /**
   * Moves a guest's items into this cart when they sign in. Quantities add up but are capped
   * rather than refused, so signing in never fails because of the basket.
   */
  absorb(other: Cart): { capped: boolean } {
    let capped = false;
    for (const line of other.snapshot.lines) {
      const total = this.quantityOf(line.listingId) + line.quantity;
      const exists = this.quantityOf(line.listingId) > 0;
      if (!exists && this.state.lines.length >= MAX_LINES) {
        capped = true;
        continue;
      }
      if (total > MAX_LINE_QUANTITY) capped = true;
      this.set(line.listingId, Math.min(total, MAX_LINE_QUANTITY));
    }
    return { capped };
  }

  markSaved(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
  }
}
