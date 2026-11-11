import 'server-only';
import { type components, createVendraClient } from '@vendra/api-client';
import { connection } from 'next/server';

export type ProductCard = components['schemas']['ProductCardResponse'];
export type ProductDetail = components['schemas']['ProductDetailResponse'];
export type StoreCategory = components['schemas']['StoreCategoryResponse'];
export type Availability = ProductCard['availability'];

/** Catalogue pages may be up to this many seconds old. Cart and checkout always re-check live stock and prices. */
const REVALIDATE_SECONDS = 30;

/**
 * Catalogue data is read when a page is requested, never at build time, so a build needs no
 * running API. connection() opts the page out of prerendering without disabling the fetch cache.
 */
async function storeApi() {
  await connection();
  const baseUrl = process.env.API_BASE_URL;
  if (!baseUrl) throw new Error('API_BASE_URL is not set');
  return createVendraClient(baseUrl, {
    fetch: (request) => fetch(request, { next: { revalidate: REVALIDATE_SECONDS } }),
  });
}

export interface ProductQuery {
  readonly q?: string;
  readonly category?: string;
  readonly brand?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** Returns 'not_found' when the category or brand does not exist, and 'expired' for a stale page link. */
export async function listProducts(query: ProductQuery) {
  const { data, response } = await (await storeApi()).GET('/v1/store/products', {
    params: { query: { ...query, limit: query.limit ?? 24 } },
  });
  if (response.status === 404 || response.status === 400) return 'not_found' as const;
  if (response.status === 422) return 'expired' as const;
  if (!data) throw new Error(`Product list failed with status ${response.status}`);
  return data;
}

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  const { data, response } = await (await storeApi()).GET('/v1/store/products/{slug}', { params: { path: { slug } } });
  if (response.status === 404 || response.status === 400) return null;
  if (!data) throw new Error(`Product request failed with status ${response.status}`);
  return data;
}

export async function listCategories(): Promise<StoreCategory[]> {
  const { data, response } = await (await storeApi()).GET('/v1/store/categories');
  if (!data) throw new Error(`Category request failed with status ${response.status}`);
  return data;
}

/** Strips anything that is not a slug, so a crafted URL cannot reach the API as something else. */
export const asSlug = (value: string | undefined): string | undefined =>
  value && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100 ? value : undefined;
