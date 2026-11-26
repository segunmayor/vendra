import { AggregateRoot, DomainError, Money } from '../../../shared-kernel';

export type ListingStatus = 'draft' | 'active' | 'inactive';

/** A seller's offer to sell one product variant at a price. */
export interface ListingState {
  readonly id: string;
  readonly variantId: string;
  readonly sellerId: string;
  readonly price: Money;
  /** The usual price, shown struck through. Always above `price`, in the same currency. Null: no discount. */
  readonly compareAt: Money | null;
  readonly status: ListingStatus;
  readonly version: number;
}

function assertPrice(price: Money): void {
  if (!price.isPositive()) throw new DomainError('listing.invalid_price', 'Price must be more than zero');
}

function assertCompareAt(price: Money, compareAt: Money | null): void {
  if (!compareAt) return;
  if (compareAt.currency !== price.currency) {
    throw new DomainError('listing.invalid_compare_at', 'The usual price must be in the same currency as the price');
  }
  if (!compareAt.isGreaterThan(price)) {
    throw new DomainError('listing.invalid_compare_at', 'The usual price must be higher than the selling price, or left empty');
  }
}

export class Listing extends AggregateRoot {
  private constructor(private state: ListingState) {
    super();
  }

  static create(input: { id: string; variantId: string; sellerId: string; price: Money; compareAt?: Money | null }): Listing {
    assertPrice(input.price);
    const compareAt = input.compareAt ?? null;
    assertCompareAt(input.price, compareAt);
    return new Listing({ ...input, compareAt, status: 'draft', version: 0 });
  }

  static rehydrate(state: ListingState): Listing {
    return new Listing(state);
  }

  get snapshot(): ListingState {
    return this.state;
  }

  markSaved(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
  }

  /**
   * Sets the selling price and, unless `compareAt` is undefined (keep it), the usual price.
   * Pass null to remove a discount.
   */
  changePrice(price: Money, now: Date, compareAt?: Money | null): void {
    assertPrice(price);
    if (price.currency !== this.state.price.currency) {
      throw new DomainError('listing.currency_change', 'A listing cannot change currency');
    }
    const nextCompareAt = compareAt === undefined ? this.state.compareAt : compareAt;
    assertCompareAt(price, nextCompareAt);
    const sameCompareAt = nextCompareAt === null ? this.state.compareAt === null : !!this.state.compareAt?.equals(nextCompareAt);
    if (price.equals(this.state.price) && sameCompareAt) return;
    const previous = this.state.price;
    this.state = { ...this.state, price, compareAt: nextCompareAt };
    this.emit('ListingPriceChanged', now, {
      previousMinor: previous.minor.toString(),
      priceMinor: price.minor.toString(),
      compareAtMinor: nextCompareAt?.minor.toString() ?? null,
      currency: price.currency,
    });
  }

  /** Only a published product can be offered for sale. */
  activate(productPublished: boolean, now: Date): void {
    if (this.state.status === 'active') return;
    if (!productPublished) {
      throw new DomainError('listing.product_not_published', 'Publish the product before activating its listing');
    }
    this.state = { ...this.state, status: 'active' };
    this.emit('ListingActivated', now);
  }

  deactivate(now: Date): void {
    if (this.state.status !== 'active') return;
    this.state = { ...this.state, status: 'inactive' };
    this.emit('ListingDeactivated', now);
  }

  private emit(type: string, now: Date, extra: Record<string, unknown> = {}): void {
    this.raise({
      type,
      aggregateId: this.state.id,
      occurredAt: now,
      payload: { variantId: this.state.variantId, sellerId: this.state.sellerId, ...extra },
    });
  }
}
