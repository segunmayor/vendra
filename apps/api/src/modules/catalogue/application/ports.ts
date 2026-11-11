import { AuditEntry } from '../../../shared-kernel';
import { AttributeDefinition } from '../domain/attributes';
import { Product, ProductStatus } from '../domain/product';

export type { ProductState, ProductStatus, Variant } from '../domain/product';

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
  /** Commits state, events and audit together. Rejects a stale version and duplicate slugs or SKUs. */
  save(product: Product, audit: AuditEntry): Promise<void>;
  list(query: { limit: number; cursor?: string; status?: ProductStatus }): Promise<ProductSummary[]>;
}
