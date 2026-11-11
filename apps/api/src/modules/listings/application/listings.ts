import { CatalogueQueries } from '../../catalogue';
import {
  ApplicationError,
  AuditEntry,
  DomainError,
  FIRST_PARTY_SELLER_ID,
  Money,
  Principal,
  SUPPORTED_CURRENCIES,
} from '../../../shared-kernel';
import { Listing, ListingState, ListingStatus } from '../domain/listing';

export type { ListingState } from '../domain/listing';

export interface ListingRepository {
  findById(id: string): Promise<Listing | null>;
  listByVariants(variantIds: readonly string[]): Promise<Listing[]>;
  /** Must throw a `listing.exists` conflict if the seller already lists this variant. */
  save(listing: Listing, audit: AuditEntry): Promise<void>;
}

export interface ListingSummary {
  readonly id: string;
  readonly sellerId: string;
  readonly variantId: string;
  readonly status: ListingStatus;
}

const listingNotFound = () => new ApplicationError('not_found', 'listing.not_found', 'Listing not found');

function parsePrice(priceMinor: string, currency: string): Money {
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new DomainError('listing.unsupported_currency', `Supported currencies: ${SUPPORTED_CURRENCIES.join(', ')}`);
  }
  return Money.of(BigInt(priceMinor), currency);
}

/** Vendra's own listings. Marketplace sellers will reuse the same aggregate after launch. */
export class ListingService {
  constructor(
    private readonly listings: ListingRepository,
    private readonly catalogue: CatalogueQueries,
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
  ) {}

  async listForProduct(productId: string): Promise<ListingState[]> {
    const variantIds = await this.catalogue.variantIdsOf(productId);
    if (!variantIds) throw new ApplicationError('not_found', 'product.not_found', 'Product not found');
    return (await this.listings.listByVariants(variantIds)).map((listing) => listing.snapshot);
  }

  async create(actor: Principal, input: { variantId: string; priceMinor: string; currency: string }): Promise<ListingState> {
    const variant = await this.catalogue.getVariant(input.variantId);
    if (!variant) throw new ApplicationError('not_found', 'variant.not_found', 'Variant not found');
    const listing = Listing.create({
      id: this.ids.uuid(),
      variantId: variant.variantId,
      sellerId: FIRST_PARTY_SELLER_ID,
      price: parsePrice(input.priceMinor, input.currency),
    });
    await this.listings.save(listing, this.audit(actor, 'listing.created', listing, { priceMinor: input.priceMinor, currency: input.currency }));
    return listing.snapshot;
  }

  async changePrice(actor: Principal, id: string, input: { priceMinor: string; currency: string }): Promise<ListingState> {
    const listing = await this.load(id);
    const before = listing.snapshot.price;
    listing.changePrice(parsePrice(input.priceMinor, input.currency), this.clock.now());
    await this.listings.save(
      listing,
      this.audit(actor, 'listing.price_changed', listing, { priceMinor: input.priceMinor }, { priceMinor: before.minor.toString() }),
    );
    return listing.snapshot;
  }

  async activate(actor: Principal, id: string): Promise<ListingState> {
    const listing = await this.load(id);
    const variant = await this.catalogue.getVariant(listing.snapshot.variantId);
    listing.activate(variant?.productStatus === 'published', this.clock.now());
    await this.listings.save(listing, this.audit(actor, 'listing.activated', listing));
    return listing.snapshot;
  }

  async deactivate(actor: Principal, id: string): Promise<ListingState> {
    const listing = await this.load(id);
    listing.deactivate(this.clock.now());
    await this.listings.save(listing, this.audit(actor, 'listing.deactivated', listing));
    return listing.snapshot;
  }

  private async load(id: string): Promise<Listing> {
    const listing = await this.listings.findById(id);
    if (!listing) throw listingNotFound();
    return listing;
  }

  private audit(
    actor: Principal,
    action: string,
    listing: Listing,
    after?: Record<string, unknown>,
    before?: Record<string, unknown>,
  ): AuditEntry {
    return { actorId: actor.accountId, action, targetType: 'listing', targetId: listing.snapshot.id, after, before };
  }
}

/** What other modules may ask about listings. */
export class ListingQueries {
  constructor(
    private readonly listings: ListingRepository,
    private readonly catalogue: CatalogueQueries,
  ) {}

  async getListing(id: string): Promise<ListingSummary | null> {
    const listing = await this.listings.findById(id);
    if (!listing) return null;
    const { sellerId, variantId, status } = listing.snapshot;
    return { id, sellerId, variantId, status };
  }

  async listingIdsOfProduct(productId: string): Promise<string[] | null> {
    const variantIds = await this.catalogue.variantIdsOf(productId);
    if (!variantIds) return null;
    return (await this.listings.listByVariants(variantIds)).map((listing) => listing.snapshot.id);
  }
}
