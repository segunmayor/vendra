import { AggregateRoot, DomainError, Money } from '../../../shared-kernel';

export type ListingStatus = 'draft' | 'active' | 'inactive';

/** A seller's offer to sell one product variant at a price. */
export interface ListingState {
  readonly id: string;
  readonly variantId: string;
  readonly sellerId: string;
  readonly price: Money;
  readonly status: ListingStatus;
  readonly version: number;
}

function assertPrice(price: Money): void {
  if (!price.isPositive()) throw new DomainError('listing.invalid_price', 'Price must be more than zero');
}

export class Listing extends AggregateRoot {
  private constructor(private state: ListingState) {
    super();
  }

  static create(input: { id: string; variantId: string; sellerId: string; price: Money }): Listing {
    assertPrice(input.price);
    return new Listing({ ...input, status: 'draft', version: 0 });
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

  changePrice(price: Money, now: Date): void {
    assertPrice(price);
    if (price.currency !== this.state.price.currency) {
      throw new DomainError('listing.currency_change', 'A listing cannot change currency');
    }
    if (price.equals(this.state.price)) return;
    const previous = this.state.price;
    this.state = { ...this.state, price };
    this.emit('ListingPriceChanged', now, {
      previousMinor: previous.minor.toString(),
      priceMinor: price.minor.toString(),
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
