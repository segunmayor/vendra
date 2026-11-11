import { ApplicationError, DomainError } from '../../../shared-kernel';
import type { AttributeDefinition, AttributeValue } from '../domain/attributes';
import type { CategoryRepository, CategoryView } from './ports';

/** What customers may see of the catalogue: published products only. */

export interface NamedRef {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface PublishedVariant {
  readonly id: string;
  readonly sku: string;
  readonly options: Readonly<Record<string, string>>;
}

export interface PublishedProduct {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly brand: NamedRef | null;
  readonly category: NamedRef;
  readonly images: readonly string[];
  readonly variants: readonly PublishedVariant[];
}

export interface PublishedProductDetail extends PublishedProduct {
  readonly description: string;
  /** Attribute values with their category labels, in the category's order. */
  readonly attributes: readonly { readonly label: string; readonly value: string }[];
  /** From the top-level category down to the product's own. */
  readonly breadcrumb: readonly NamedRef[];
}

export interface StorefrontCategory extends NamedRef {
  readonly parentId: string | null;
  /** Published products in this category and everything below it. */
  readonly productCount: number;
}

/** Where a result list continues. Search pages by rank, browsing by newest first. */
export type SearchPosition =
  | { readonly kind: 'rank'; readonly offset: number }
  | { readonly kind: 'newest'; readonly createdAt: string; readonly id: string };

export interface SearchFilter {
  readonly text?: string;
  readonly categoryIds?: readonly string[];
  readonly brandId?: string;
}

/**
 * The search port. Launch uses PostgreSQL full-text and trigram search; a search engine
 * such as Meilisearch can implement this later without changing callers.
 */
export interface ProductSearch {
  search(
    filter: SearchFilter,
    after: SearchPosition | null,
    limit: number,
  ): Promise<{ items: { product: PublishedProduct; position: SearchPosition }[]; hasMore: boolean }>;
  findPublishedBySlug(slug: string): Promise<(PublishedProduct & { description: string; attributes: Record<string, AttributeValue> }) | null>;
  countPublishedByCategory(): Promise<Map<string, number>>;
  findBrandBySlug(slug: string): Promise<NamedRef | null>;
}

const MAX_OFFSET = 1_000;
const MAX_QUERY_LENGTH = 100;

const invalidCursor = () => new DomainError('catalogue.invalid_cursor', 'This page link is no longer valid. Start from the first page.');

/** Cursors are opaque to clients: base64url JSON, checked strictly on the way back in. */
export function encodeCursor(position: SearchPosition): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

export function decodeCursor(cursor: string, expected: SearchPosition['kind']): SearchPosition {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (typeof value !== 'object' || value === null) throw invalidCursor();
  const record = value as Record<string, unknown>;
  if (record.kind !== expected) throw invalidCursor();
  if (expected === 'rank') {
    const offset = record.offset;
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw invalidCursor();
    return { kind: 'rank', offset };
  }
  const { createdAt, id } = record;
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt)) || typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) {
    throw invalidCursor();
  }
  return { kind: 'newest', createdAt, id };
}

/** Collapses whitespace and limits length. Returns undefined for a blank query. */
export function normalizeQuery(raw: string | undefined): string | undefined {
  const text = raw?.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
  return text ? text : undefined;
}

function descendants(categories: readonly CategoryView[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const category of categories) {
    if (!category.parentId) continue;
    children.set(category.parentId, [...(children.get(category.parentId) ?? []), category.id]);
  }
  const result: string[] = [];
  const queue = [rootId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue; // guards against a cycle in bad data
    seen.add(id);
    result.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return result;
}

function displayValue(definition: AttributeDefinition, value: AttributeValue): string {
  if (definition.type === 'boolean') return value === true ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString('en-NG');
  return String(value);
}

export interface StorefrontSearchInput {
  readonly text?: string;
  readonly categorySlug?: string;
  readonly brandSlug?: string;
  readonly cursor?: string;
  readonly limit: number;
}

export interface StorefrontSearchPage {
  readonly items: readonly { readonly product: PublishedProduct; readonly cursor: string }[];
  readonly nextCursor: string | null;
}

/** The catalogue's contract for the storefront. Other modules never read its tables. */
export class StorefrontCatalogue {
  constructor(
    private readonly search: ProductSearch,
    private readonly categories: CategoryRepository,
  ) {}

  async listCategories(): Promise<StorefrontCategory[]> {
    const [categories, counts] = await Promise.all([this.categories.list(), this.search.countPublishedByCategory()]);
    return categories.map((category) => ({
      id: category.id,
      parentId: category.parentId,
      name: category.name,
      slug: category.slug,
      productCount: descendants(categories, category.id).reduce((sum, id) => sum + (counts.get(id) ?? 0), 0),
    }));
  }

  async searchProducts(input: StorefrontSearchInput): Promise<StorefrontSearchPage> {
    const text = normalizeQuery(input.text);
    const kind = text ? 'rank' : 'newest';
    const after = input.cursor ? decodeCursor(input.cursor, kind) : null;

    let categoryIds: string[] | undefined;
    if (input.categorySlug) {
      const all = await this.categories.list();
      const root = all.find((category) => category.slug === input.categorySlug);
      if (!root) throw new ApplicationError('not_found', 'catalogue.category_not_found', 'This category does not exist');
      categoryIds = descendants(all, root.id);
    }
    let brandId: string | undefined;
    if (input.brandSlug) {
      const brand = await this.search.findBrandBySlug(input.brandSlug);
      if (!brand) throw new ApplicationError('not_found', 'catalogue.brand_not_found', 'This brand does not exist');
      brandId = brand.id;
    }

    const page = await this.search.search({ text, categoryIds, brandId }, after, input.limit);
    const items = page.items
      .filter((item) => item.position.kind !== 'rank' || item.position.offset <= MAX_OFFSET)
      .map((item) => ({ product: item.product, cursor: encodeCursor(item.position) }));
    const last = items.at(-1);
    return { items, nextCursor: page.hasMore && last && items.length === page.items.length ? last.cursor : null };
  }

  async productBySlug(slug: string): Promise<PublishedProductDetail | null> {
    const product = await this.search.findPublishedBySlug(slug);
    if (!product) return null;
    const all = await this.categories.list();
    const byId = new Map(all.map((category) => [category.id, category]));
    const breadcrumb: NamedRef[] = [];
    const seen = new Set<string>();
    for (let current = byId.get(product.category.id); current && !seen.has(current.id); current = current.parentId ? byId.get(current.parentId) : undefined) {
      seen.add(current.id);
      breadcrumb.unshift({ id: current.id, name: current.name, slug: current.slug });
    }
    const definitions = byId.get(product.category.id)?.attributes ?? [];
    const attributes = definitions
      .filter((definition) => product.attributes[definition.key] !== undefined && product.attributes[definition.key] !== null)
      .map((definition) => ({ label: definition.label, value: displayValue(definition, product.attributes[definition.key]!) }));
    const { attributes: _raw, ...rest } = product;
    return { ...rest, attributes, breadcrumb };
  }
}
