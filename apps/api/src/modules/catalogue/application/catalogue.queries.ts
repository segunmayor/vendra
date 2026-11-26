import { ProductStatus } from '../domain/product';
import { ImageAddresses, ProductRepository } from './ports';

export interface VariantSummary {
  readonly variantId: string;
  readonly sku: string;
  readonly productId: string;
  readonly productName: string;
  readonly productStatus: ProductStatus;
  readonly productSlug: string;
  readonly weightGrams: number;
  readonly options: Readonly<Record<string, string>>;
  readonly image: string | null;
}

/** What other modules may ask the catalogue. They never read its tables. */
export class CatalogueQueries {
  constructor(
    private readonly products: ProductRepository & {
      findVariant(id: string): Promise<VariantSummary | null>;
      findVariants(ids: readonly string[]): Promise<VariantSummary[]>;
    },
    private readonly images: ImageAddresses,
  ) {}

  /** Photos from a storage location's public address (CDN) where one is set up. */
  private async withAddresses(variants: VariantSummary[]): Promise<VariantSummary[]> {
    const addresses = await this.images.resolve(variants.flatMap((variant) => (variant.image ? [variant.image] : [])));
    if (addresses.size === 0) return variants;
    return variants.map((variant) => (variant.image && addresses.has(variant.image) ? { ...variant, image: addresses.get(variant.image)! } : variant));
  }

  /** Several variants at once, for pricing a basket. Unknown ids are left out. */
  getVariants(variantIds: readonly string[]): Promise<VariantSummary[]> {
    return variantIds.length === 0 ? Promise.resolve([]) : this.products.findVariants(variantIds).then((variants) => this.withAddresses(variants));
  }

  async getVariant(variantId: string): Promise<VariantSummary | null> {
    const variant = await this.products.findVariant(variantId);
    return variant ? ((await this.withAddresses([variant]))[0] ?? null) : null;
  }

  async variantIdsOf(productId: string): Promise<string[] | null> {
    const product = await this.products.findById(productId);
    return product ? product.snapshot.variants.map((variant) => variant.id) : null;
  }
}
