import { Money } from '../../../shared-kernel';
import type { PublishedProduct, StorefrontCatalogue } from '../../catalogue';
import type { InventoryQueries } from '../../inventory';
import type { ActiveOffer, ListingQueries } from '../../listings';
import type { SettingsReader } from '../../settings';
import { StorefrontService } from './storefront.service';

const ngn = (minor: bigint) => Money.of(minor, 'NGN');
const category = { id: 'c1', name: 'Phones', slug: 'phones' };

function product(id: string, variantIds: string[]): PublishedProduct {
  return {
    id,
    slug: id,
    name: `Product ${id}`,
    brand: null,
    category,
    images: [],
    variants: variantIds.map((variantId) => ({ id: variantId, sku: variantId.toUpperCase(), options: {} })),
  };
}

/** A catalogue of products returned in order, paged by position, as the real search does. */
function setup(products: PublishedProduct[], offers: ActiveOffer[], stock: Record<string, number>) {
  const searchCalls: { cursor?: string; limit: number }[] = [];
  const catalogue = {
    searchProducts: async (input: { cursor?: string; limit: number }) => {
      searchCalls.push({ cursor: input.cursor, limit: input.limit });
      const start = input.cursor ? Number(input.cursor) : 0;
      const slice = products.slice(start, start + input.limit);
      return {
        items: slice.map((entry, index) => ({ product: entry, cursor: String(start + index + 1) })),
        nextCursor: start + input.limit < products.length ? String(start + input.limit) : null,
      };
    },
    productBySlug: async (slug: string) => {
      const found = products.find((entry) => entry.slug === slug);
      return found ? { ...found, description: '', attributes: [], breadcrumb: [category] } : null;
    },
    listCategories: async () => [
      { ...category, parentId: null, productCount: 2 },
      { id: 'c2', name: 'Empty', slug: 'empty', parentId: null, productCount: 0 },
    ],
  } as unknown as StorefrontCatalogue;
  const listings = {
    activeOffers: async (variantIds: readonly string[]) => offers.filter((offer) => variantIds.includes(offer.variantId)),
  } as unknown as ListingQueries;
  const inventory = {
    availableByListing: async (ids: readonly string[]) => new Map(ids.map((id) => [id, stock[id] ?? 0])),
  } as unknown as InventoryQueries;
  const settings = { get: async () => 5 } as unknown as SettingsReader;
  return { service: new StorefrontService(catalogue, listings, inventory, settings), searchCalls };
}

const offer = (variantId: string, minor: bigint, listingId = `l-${variantId}`): ActiveOffer => ({
  listingId,
  variantId,
  sellerId: 's1',
  price: ngn(minor),
});

describe('StorefrontService', () => {
  it('hides products with no active listing and keeps out-of-stock ones, marked', async () => {
    const { service } = setup(
      [product('a', ['a1']), product('b', ['b1']), product('c', ['c1'])],
      [offer('a1', 100n), offer('c1', 300n)],
      { 'l-a1': 10 },
    );
    const page = await service.browse({ limit: 10 });
    expect(page.items.map((item) => [item.id, item.availability])).toEqual([
      ['a', 'in_stock'],
      ['c', 'out_of_stock'],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('reads further batches to fill a page, and continues right after the last item shown', async () => {
    // Every other product is unlisted.
    const products = Array.from({ length: 10 }, (_, index) => product(`p${index}`, [`v${index}`]));
    const offers = products.filter((_, index) => index % 2 === 0).map((entry) => offer(entry.variants[0]!.id, 100n));
    const { service } = setup(products, offers, {});

    const first = await service.browse({ limit: 3 });
    expect(first.items.map((item) => item.id)).toEqual(['p0', 'p2', 'p4']);
    const second = await service.browse({ limit: 3, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.id)).toEqual(['p6', 'p8']);
    expect(second.nextCursor).toBeNull();
  });

  it('does not skip a sellable product that follows the cut-off within a batch', async () => {
    // Batch 1 is [hidden, a]; batch 2 is [b, c]. The page fills at b, so c must open the next page.
    const products = [product('hidden', ['h1']), product('a', ['a1']), product('b', ['b1']), product('c', ['c1'])];
    const { service } = setup(products, ['a1', 'b1', 'c1'].map((id) => offer(id, 100n)), {});
    const first = await service.browse({ limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(['a', 'b']);
    const second = await service.browse({ limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.id)).toEqual(['c']);
  });

  it('stops after a bounded number of batches and hands back where it stopped', async () => {
    const products = Array.from({ length: 50 }, (_, index) => product(`p${index}`, [`v${index}`]));
    const { service, searchCalls } = setup(products, [offer('v49', 100n)], {});
    const page = await service.browse({ limit: 2 });
    expect(page.items).toEqual([]);
    expect(searchCalls).toHaveLength(4);
    expect(page.nextCursor).toBe('8');
    const rest = await service.browse({ limit: 2, cursor: page.nextCursor! });
    expect(rest.items).toEqual([]);
  });

  it('returns a cursor when the page fills mid-batch, but none when the catalogue is exhausted', async () => {
    const products = [product('a', ['a1']), product('b', ['b1'])];
    const { service } = setup(products, [offer('a1', 1n), offer('b1', 1n)], {});
    expect((await service.browse({ limit: 1 })).nextCursor).toBe('1');
    expect((await service.browse({ limit: 2 })).nextCursor).toBeNull();
  });

  it('shows a price range across variants and the best availability', async () => {
    const { service } = setup(
      [product('a', ['a1', 'a2', 'a3'])],
      [offer('a1', 5_000_00n), offer('a2', 3_500_00n), offer('a3', 9_000_00n)],
      { 'l-a1': 0, 'l-a2': 3, 'l-a3': 0 },
    );
    const [card] = (await service.browse({ limit: 5 })).items;
    expect(card?.priceFrom.minor).toBe(3_500_00n);
    expect(card?.priceTo.minor).toBe(9_000_00n);
    expect(card?.availability).toBe('low_stock');
  });

  it.each([
    [0, 'out_of_stock', null],
    [-2, 'out_of_stock', null],
    [1, 'low_stock', 1],
    [5, 'low_stock', 5],
    [6, 'in_stock', null],
  ])('with %s available shows %s and discloses quantity %s', async (available, availability, quantity) => {
    const { service } = setup([product('a', ['a1'])], [offer('a1', 100n)], { 'l-a1': available });
    const page = await service.product('a');
    expect(page?.variants[0]?.offer).toMatchObject({ availability, lowStockQuantity: quantity });
  });

  it('offers the cheapest listing when several sellers list one variant', async () => {
    const { service } = setup([product('a', ['a1'])], [offer('a1', 900n, 'dear'), offer('a1', 700n, 'cheap')], { cheap: 4 });
    const page = await service.product('a');
    expect(page?.variants[0]?.offer.listingId).toBe('cheap');
  });

  it('omits unlisted variants from the product page, and hides a product with none listed', async () => {
    const { service } = setup([product('a', ['a1', 'a2']), product('b', ['b1'])], [offer('a2', 100n)], {});
    expect((await service.product('a'))?.variants.map((variant) => variant.id)).toEqual(['a2']);
    expect(await service.product('b')).toBeNull();
    expect(await service.product('missing')).toBeNull();
  });

  it('lists only categories that have products', async () => {
    const { service } = setup([], [], {});
    expect((await service.categories()).map((entry) => entry.slug)).toEqual(['phones']);
  });
});
