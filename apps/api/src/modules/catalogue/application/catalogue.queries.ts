import { ProductStatus } from '../domain/product';
import { ProductRepository } from './ports';

export interface VariantSummary {
  readonly variantId: string;
  readonly sku: string;
  readonly productId: string;
  readonly productName: string;
  readonly productStatus: ProductStatus;
}

/** What other modules may ask the catalogue. They never read its tables. */
export class CatalogueQueries {
  constructor(private readonly products: ProductRepository & { findVariant(id: string): Promise<VariantSummary | null> }) {}

  getVariant(variantId: string): Promise<VariantSummary | null> {
    return this.products.findVariant(variantId);
  }

  async variantIdsOf(productId: string): Promise<string[] | null> {
    const product = await this.products.findById(productId);
    return product ? product.snapshot.variants.map((variant) => variant.id) : null;
  }
}
