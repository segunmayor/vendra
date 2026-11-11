import { ProductStatus } from '../domain/product';
import { ProductRepository } from './ports';

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
  ) {}

  /** Several variants at once, for pricing a basket. Unknown ids are left out. */
  getVariants(variantIds: readonly string[]): Promise<VariantSummary[]> {
    return variantIds.length === 0 ? Promise.resolve([]) : this.products.findVariants(variantIds);
  }

  getVariant(variantId: string): Promise<VariantSummary | null> {
    return this.products.findVariant(variantId);
  }

  async variantIdsOf(productId: string): Promise<string[] | null> {
    const product = await this.products.findById(productId);
    return product ? product.snapshot.variants.map((variant) => variant.id) : null;
  }
}
