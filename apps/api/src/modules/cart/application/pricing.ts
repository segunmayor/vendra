import { Money } from '../../../shared-kernel';
import { CatalogueQueries } from '../../catalogue';
import { InventoryQueries } from '../../inventory';
import { ListingQueries } from '../../listings';
import type { CartLine } from '../domain/cart';

export type LineIssue = 'unavailable' | 'out_of_stock' | 'insufficient_stock';

export interface PricedLine {
  readonly listingId: string;
  readonly variantId: string | null;
  readonly sku: string | null;
  readonly productName: string;
  readonly productSlug: string | null;
  readonly options: Readonly<Record<string, string>>;
  readonly image: string | null;
  readonly quantity: number;
  /** Null when the item is no longer for sale. */
  readonly unitPrice: Money | null;
  readonly lineTotal: Money | null;
  readonly weightGrams: number;
  readonly issue: LineIssue | null;
  /** Units available, shown only when there are fewer than the customer wants. */
  readonly availableQuantity: number | null;
}

export interface PricedCart {
  readonly lines: readonly PricedLine[];
  readonly itemCount: number;
  /** Lines without an issue. */
  readonly subtotal: Money;
  readonly weightGrams: number;
  readonly canCheckout: boolean;
}

export const CURRENCY = 'NGN';

/**
 * Prices a basket from live data: the listing's current price and status, the product's
 * publication, and stock available now. Shared by the cart view and checkout, so both
 * apply the same rules.
 */
export class CartPricing {
  constructor(
    private readonly listings: ListingQueries,
    private readonly catalogue: CatalogueQueries,
    private readonly inventory: InventoryQueries,
  ) {}

  async price(lines: readonly CartLine[]): Promise<PricedCart> {
    const ids = lines.map((line) => line.listingId);
    const offers = new Map((await this.listings.getOffers(ids)).map((offer) => [offer.id, offer]));
    const variants = new Map(
      (await this.catalogue.getVariants([...new Set([...offers.values()].map((offer) => offer.variantId))])).map((variant) => [variant.variantId, variant]),
    );
    const stock = await this.inventory.availableByListing(ids);

    const priced = lines.map((line): PricedLine => {
      const offer = offers.get(line.listingId);
      const variant = offer ? variants.get(offer.variantId) : undefined;
      const sellable = !!offer && !!variant && offer.status === 'active' && variant.productStatus === 'published' && offer.price.currency === CURRENCY;
      const available = stock.get(line.listingId) ?? 0;
      const issue: LineIssue | null = !sellable ? 'unavailable' : available === 0 ? 'out_of_stock' : available < line.quantity ? 'insufficient_stock' : null;
      return {
        listingId: line.listingId,
        variantId: variant?.variantId ?? null,
        sku: variant?.sku ?? null,
        productName: variant?.productName ?? 'Item no longer available',
        productSlug: variant?.productSlug ?? null,
        options: variant?.options ?? {},
        image: variant?.image ?? null,
        quantity: line.quantity,
        unitPrice: sellable ? offer.price : null,
        lineTotal: sellable ? offer.price.times(line.quantity) : null,
        weightGrams: (variant?.weightGrams ?? 0) * line.quantity,
        issue,
        availableQuantity: issue === 'insufficient_stock' ? available : null,
      };
    });

    const good = priced.filter((line) => line.issue === null);
    return {
      lines: priced,
      itemCount: priced.reduce((sum, line) => sum + line.quantity, 0),
      subtotal: good.reduce((sum, line) => sum.add(line.lineTotal!), Money.zero(CURRENCY)),
      weightGrams: good.reduce((sum, line) => sum + line.weightGrams, 0),
      canCheckout: priced.length > 0 && good.length === priced.length,
    };
  }
}
