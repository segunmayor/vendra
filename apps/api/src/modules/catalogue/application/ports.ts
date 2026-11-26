import { AuditEntry } from '../../../shared-kernel';
import { AttributeDefinition } from '../domain/attributes';
import { Product, ProductStatus } from '../domain/product';

export type { ProductState, ProductStatus, Variant } from '../domain/product';
export type { AttributeDefinition, AttributeValue } from '../domain/attributes';

export interface Clock {
  now(): Date;
}

export interface Ids {
  uuid(): string;
}

export interface CategoryView {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly slug: string;
  readonly attributes: readonly AttributeDefinition[];
}

export interface BrandView {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface ProductSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: ProductStatus;
  readonly categoryId: string;
  readonly brandId: string | null;
  readonly variantCount: number;
  readonly updatedAt: Date;
}

export interface CategoryRepository {
  list(): Promise<CategoryView[]>;
  findById(id: string): Promise<CategoryView | null>;
  /** Must throw a `category.slug_taken` conflict for a duplicate slug. */
  create(category: CategoryView, audit: AuditEntry): Promise<void>;
  update(category: CategoryView, audit: AuditEntry): Promise<void>;
}

export interface BrandRepository {
  list(): Promise<BrandView[]>;
  findById(id: string): Promise<BrandView | null>;
  /** Must throw a `brand.name_taken` conflict for a duplicate name or slug. */
  create(brand: BrandView, audit: AuditEntry): Promise<void>;
}

export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  findBySlug(slug: string): Promise<Product | null>;
  /** The product that owns each SKU. SKUs nobody uses are left out. */
  skuOwners(skus: readonly string[]): Promise<Map<string, string>>;
  /** Commits state, events and audit together. Rejects a stale version and duplicate slugs or SKUs. */
  save(product: Product, audit: AuditEntry): Promise<void>;
  list(query: { limit: number; cursor?: string; status?: ProductStatus }): Promise<ProductSummary[]>;
}

export interface StoredMedia {
  readonly id: string;
  readonly contentType: string;
  readonly extension: string;
}

export interface MediaStore {
  findBySourceUrl(url: string): Promise<StoredMedia | null>;
  /** Stores the file once per sha256. Saving bytes already stored returns the existing record. */
  save(media: { id: string; sha256: string; contentType: string; extension: string; content: Uint8Array; sourceUrl: string | null }): Promise<StoredMedia>;
  read(id: string): Promise<{ contentType: string; content: Uint8Array } | null>;
  /** The stored object behind each photo kept in a storage location. Photos in the database are left out. */
  objectIdsOf(ids: readonly string[]): Promise<Map<string, string>>;
}

/** Public (CDN) addresses for stored files, where the storage location serves them publicly. */
export interface PublicFileUrls {
  publicUrls(objectIds: readonly string[]): Promise<Map<string, string>>;
  /** Changes when storage settings change in this process. */
  generation(): number;
}

/** Turns photo paths ("/media/<id>.<ext>") into the address browsers should load them from. */
export interface ImageAddresses {
  resolve(paths: readonly string[]): Promise<Map<string, string>>;
}

export interface DownloadLimits {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly allowHttp: boolean;
}

/**
 * Fetches a file from the internet on a staff member's behalf. Must refuse private and
 * internal addresses (including after redirects and DNS changes), stop at `maxBytes`, and
 * throw a DomainError whose message staff can act on.
 */
export interface RemoteFiles {
  download(url: string, limits: DownloadLimits): Promise<Uint8Array>;
}

export interface Hasher {
  sha256(bytes: Uint8Array): string;
}
