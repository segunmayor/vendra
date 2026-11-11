import { AggregateRoot, DomainError } from '../../../shared-kernel';
import { AttributeDefinition, AttributeValue, assertName, toSlug, validateAttributes } from './attributes';

export type ProductStatus = 'draft' | 'published' | 'archived';

export interface Variant {
  readonly id: string;
  readonly sku: string;
  readonly options: Readonly<Record<string, string>>;
  readonly weightGrams: number;
}

export interface ProductState {
  readonly id: string;
  readonly categoryId: string;
  readonly brandId: string | null;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
  readonly status: ProductStatus;
  readonly variants: readonly Variant[];
  readonly version: number;
}

export interface ProductDetails {
  readonly name: string;
  readonly description: string;
  readonly brandId: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
}

const SKU = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
const MAX_DESCRIPTION = 5000;
const MAX_VARIANTS = 100;

function assertDescription(description: string): string {
  if (description.length > MAX_DESCRIPTION) {
    throw new DomainError('product.invalid_description', `Descriptions are limited to ${MAX_DESCRIPTION} characters`);
  }
  return description.trim();
}

export class Product extends AggregateRoot {
  private constructor(private state: ProductState) {
    super();
  }

  static create(
    input: ProductDetails & { id: string; categoryId: string; slug?: string },
    definitions: readonly AttributeDefinition[],
  ): Product {
    const name = assertName(input.name);
    return new Product({
      id: input.id,
      categoryId: input.categoryId,
      brandId: input.brandId,
      name,
      slug: toSlug(input.slug || name),
      description: assertDescription(input.description),
      attributes: validateAttributes(definitions, input.attributes, false),
      status: 'draft',
      variants: [],
      version: 0,
    });
  }

  static rehydrate(state: ProductState): Product {
    return new Product(state);
  }

  get snapshot(): ProductState {
    return this.state;
  }

  markSaved(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
  }

  /** A published product must stay complete, so edits to it are checked as strictly as publishing. */
  update(details: ProductDetails, definitions: readonly AttributeDefinition[], now: Date): void {
    const published = this.state.status === 'published';
    this.state = {
      ...this.state,
      name: assertName(details.name),
      description: assertDescription(details.description),
      brandId: details.brandId,
      attributes: validateAttributes(definitions, details.attributes, published),
    };
    if (published) this.emit('ProductUpdated', now);
  }

  addVariant(input: { id: string; sku: string; options: Record<string, string>; weightGrams: number }, now: Date): Variant {
    const sku = input.sku.trim().toUpperCase();
    if (!SKU.test(sku)) {
      throw new DomainError('variant.invalid_sku', 'SKUs are 2 to 64 letters, digits, dots, dashes or underscores');
    }
    if (this.state.variants.some((variant) => variant.sku === sku)) {
      throw new DomainError('variant.duplicate_sku', `This product already has SKU ${sku}`);
    }
    if (this.state.variants.length >= MAX_VARIANTS) {
      throw new DomainError('variant.too_many', `A product can have at most ${MAX_VARIANTS} variants`);
    }
    if (!Number.isInteger(input.weightGrams) || input.weightGrams <= 0 || input.weightGrams > 1_000_000) {
      throw new DomainError('variant.invalid_weight', 'Weight must be a whole number of grams, up to 1,000,000');
    }
    const options = Object.entries(input.options);
    if (options.length > 10 || options.some(([key, value]) => !key.trim() || !value.trim() || key.length > 40 || value.length > 80)) {
      throw new DomainError('variant.invalid_options', 'Options need a name and value, up to 10 per variant');
    }
    const variant: Variant = {
      id: input.id,
      sku,
      weightGrams: input.weightGrams,
      options: Object.fromEntries(options.map(([key, value]) => [key.trim(), value.trim()])),
    };
    this.state = { ...this.state, variants: [...this.state.variants, variant] };
    if (this.state.status === 'published') this.emit('ProductUpdated', now);
    return variant;
  }

  /** Re-checks attributes, because the category's definitions may have changed since they were entered. */
  publish(definitions: readonly AttributeDefinition[], now: Date): void {
    if (this.state.status === 'published') return;
    if (this.state.variants.length === 0) {
      throw new DomainError('product.no_variants', 'Add at least one variant before publishing');
    }
    const attributes = validateAttributes(definitions, this.state.attributes, true);
    this.state = { ...this.state, attributes, status: 'published' };
    this.emit('ProductPublished', now);
  }

  archive(now: Date): void {
    if (this.state.status === 'archived') return;
    this.state = { ...this.state, status: 'archived' };
    this.emit('ProductArchived', now);
  }

  private emit(type: string, now: Date): void {
    this.raise({ type, aggregateId: this.state.id, occurredAt: now, payload: { slug: this.state.slug } });
  }
}
