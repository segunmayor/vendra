import { Money } from '../../../shared-kernel';
import { NamedRef, PublishedProduct, PublishedProductDetail, StorefrontCatalogue } from '../../catalogue';
import { InventoryQueries } from '../../inventory';
import { ActiveOffer, ListingQueries } from '../../listings';
import { SettingsReader } from '../../settings';

export type Availability = 'in_stock' | 'low_stock' | 'out_of_stock';

/** Extra catalogue batches read to fill a page when some products have no active listing. */
const MAX_ROUNDS = 4;

export interface Offer {
  readonly listingId: string;
  readonly price: Money;
  readonly availability: Availability;
  /** Shown only for low stock, so exact stock levels are not disclosed. */
  readonly lowStockQuantity: number | null;
}

export interface ProductCard {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly brand: NamedRef | null;
  readonly category: NamedRef;
  readonly image: string | null;
  readonly priceFrom: Money;
  readonly priceTo: Money;
  readonly availability: Availability;
}

export interface ProductPage extends Omit<PublishedProductDetail, 'variants'> {
  readonly priceFrom: Money;
  readonly priceTo: Money;
  readonly availability: Availability;
  readonly variants: readonly { readonly id: string; readonly sku: string; readonly options: Readonly<Record<string, string>>; readonly offer: Offer }[];
}

export interface BrowseInput {
  readonly text?: string;
  readonly categorySlug?: string;
  readonly brandSlug?: string;
  readonly cursor?: string;
  readonly limit: number;
}

const RANK: Record<Availability, number> = { in_stock: 2, low_stock: 1, out_of_stock: 0 };

/** At or below `lowStock` units (setting store.lowStockThreshold), customers see "Only N left". */
function availabilityOf(available: number, lowStock: number): Pick<Offer, 'availability' | 'lowStockQuantity'> {
  if (available <= 0) return { availability: 'out_of_stock', lowStockQuantity: null };
  if (available <= lowStock) return { availability: 'low_stock', lowStockQuantity: available };
  return { availability: 'in_stock', lowStockQuantity: null };
}

/** Best availability across variants: a product is in stock if any variant is. */
const best = (offers: readonly Offer[]): Availability =>
  offers.reduce<Availability>((current, offer) => (RANK[offer.availability] > RANK[current] ? offer.availability : current), 'out_of_stock');

/**
 * The customer's view of what is for sale. It owns no data: it combines the catalogue's
 * published products with active listings and available stock, through their contracts.
 * A product is shown only when it is published and at least one variant has an active
 * listing. Out-of-stock products stay visible, marked as such.
 */
export class StorefrontService {
  constructor(
    private readonly catalogue: StorefrontCatalogue,
    private readonly listings: ListingQueries,
    private readonly inventory: InventoryQueries,
    private readonly settings: SettingsReader,
  ) {}

  async categories() {
    return (await this.catalogue.listCategories()).filter((category) => category.productCount > 0);
  }

  async browse(input: BrowseInput): Promise<{ items: ProductCard[]; nextCursor: string | null }> {
    const items: ProductCard[] = [];
    let cursor = input.cursor;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const page = await this.catalogue.searchProducts({ ...input, cursor, limit: input.limit });
      const offers = await this.offersFor(page.items.flatMap((item) => item.product.variants.map((variant) => variant.id)));
      for (const [index, item] of page.items.entries()) {
        const card = this.toCard(item.product, offers);
        if (!card) continue;
        items.push(card);
        if (items.length === input.limit) {
          const isLast = index === page.items.length - 1;
          return { items, nextCursor: isLast ? page.nextCursor : item.cursor };
        }
      }
      if (!page.nextCursor) return { items, nextCursor: null };
      cursor = page.nextCursor;
    }
    // Page not filled within the bound: hand back where reading stopped, so nothing is skipped.
    return { items, nextCursor: cursor ?? null };
  }

  async product(slug: string): Promise<ProductPage | null> {
    const product = await this.catalogue.productBySlug(slug);
    if (!product) return null;
    const offers = await this.offersFor(product.variants.map((variant) => variant.id));
    const variants = product.variants.flatMap((variant) => {
      const offer = offers.get(variant.id);
      return offer ? [{ ...variant, offer }] : [];
    });
    if (variants.length === 0) return null;
    const prices = variants.map((variant) => variant.offer.price);
    return {
      ...product,
      variants,
      priceFrom: prices.reduce((low, price) => (price.minor < low.minor ? price : low)),
      priceTo: prices.reduce((high, price) => (price.minor > high.minor ? price : high)),
      availability: best(variants.map((variant) => variant.offer)),
    };
  }

  /** The cheapest active offer per variant, with its available stock. */
  private async offersFor(variantIds: readonly string[]): Promise<Map<string, Offer>> {
    const active = await this.listings.activeOffers(variantIds);
    const stock = await this.inventory.availableByListing(active.map((offer) => offer.listingId));
    const lowStock = await this.settings.get('store.lowStockThreshold');
    const cheapest = new Map<string, ActiveOffer>();
    for (const offer of active) {
      const current = cheapest.get(offer.variantId);
      if (!current || offer.price.minor < current.price.minor) cheapest.set(offer.variantId, offer);
    }
    return new Map(
      [...cheapest].map(([variantId, offer]) => [
        variantId,
        { listingId: offer.listingId, price: offer.price, ...availabilityOf(stock.get(offer.listingId) ?? 0, lowStock) },
      ]),
    );
  }

  private toCard(product: PublishedProduct, offers: Map<string, Offer>): ProductCard | null {
    const sellable = product.variants.map((variant) => offers.get(variant.id)).filter((offer): offer is Offer => !!offer);
    if (sellable.length === 0) return null;
    const prices = sellable.map((offer) => offer.price);
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      category: product.category,
      image: product.images[0] ?? null,
      priceFrom: prices.reduce((low, price) => (price.minor < low.minor ? price : low)),
      priceTo: prices.reduce((high, price) => (price.minor > high.minor ? price : high)),
      availability: best(sellable),
    };
  }
}
