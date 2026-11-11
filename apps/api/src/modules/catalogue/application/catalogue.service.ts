import { ApplicationError, AuditEntry, Principal } from '../../../shared-kernel';
import { assertName, parseAttributeSchema, toSlug } from '../domain/attributes';
import { Product, ProductDetails, ProductState, ProductStatus, Variant } from '../domain/product';
import {
  BrandRepository,
  BrandView,
  CategoryRepository,
  CategoryView,
  Clock,
  Ids,
  ProductRepository,
  ProductSummary,
} from './ports';

const notFound = (what: string) => new ApplicationError('not_found', `${what}.not_found`, `${what[0]?.toUpperCase()}${what.slice(1)} not found`);

export class CatalogueService {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly brands: BrandRepository,
    private readonly products: ProductRepository,
    private readonly ids: Ids,
    private readonly clock: Clock,
  ) {}

  listCategories(): Promise<CategoryView[]> {
    return this.categories.list();
  }

  async createCategory(
    actor: Principal,
    input: { name: string; slug?: string; parentId: string | null; attributes: unknown },
  ): Promise<CategoryView> {
    if (input.parentId && !(await this.categories.findById(input.parentId))) throw notFound('category');
    const name = assertName(input.name, 100);
    const category: CategoryView = {
      id: this.ids.uuid(),
      parentId: input.parentId,
      name,
      slug: toSlug(input.slug || name),
      attributes: parseAttributeSchema(input.attributes),
    };
    await this.categories.create(category, this.audit(actor, 'catalogue.category_created', 'category', category.id, { ...category }));
    return category;
  }

  /** Existing products are re-checked against new definitions when next edited or published. */
  async updateCategory(actor: Principal, id: string, input: { name: string; attributes: unknown }): Promise<CategoryView> {
    const current = await this.categories.findById(id);
    if (!current) throw notFound('category');
    const next: CategoryView = { ...current, name: assertName(input.name, 100), attributes: parseAttributeSchema(input.attributes) };
    await this.categories.update(
      next,
      this.audit(actor, 'catalogue.category_updated', 'category', id, { ...next }, { ...current }),
    );
    return next;
  }

  listBrands(): Promise<BrandView[]> {
    return this.brands.list();
  }

  async createBrand(actor: Principal, name: string): Promise<BrandView> {
    const clean = assertName(name, 100);
    const brand: BrandView = { id: this.ids.uuid(), name: clean, slug: toSlug(clean) };
    await this.brands.create(brand, this.audit(actor, 'catalogue.brand_created', 'brand', brand.id, { ...brand }));
    return brand;
  }

  listProducts(query: { limit: number; cursor?: string; status?: ProductStatus }): Promise<ProductSummary[]> {
    return this.products.list(query);
  }

  async getProduct(id: string): Promise<ProductState> {
    return (await this.load(id)).snapshot;
  }

  async createProduct(
    actor: Principal,
    input: ProductDetails & { categoryId: string; slug?: string },
  ): Promise<ProductState> {
    const category = await this.categories.findById(input.categoryId);
    if (!category) throw notFound('category');
    await this.assertBrand(input.brandId);
    const product = Product.create({ ...input, id: this.ids.uuid() }, category.attributes);
    await this.products.save(
      product,
      this.audit(actor, 'catalogue.product_created', 'product', product.snapshot.id, { name: product.snapshot.name }),
    );
    return product.snapshot;
  }

  async updateProduct(actor: Principal, id: string, details: ProductDetails): Promise<ProductState> {
    const product = await this.load(id);
    await this.assertBrand(details.brandId);
    const before = product.snapshot;
    product.update(details, await this.definitionsFor(product), this.clock.now());
    await this.products.save(
      product,
      this.audit(actor, 'catalogue.product_updated', 'product', id, this.editable(product.snapshot), this.editable(before)),
    );
    return product.snapshot;
  }

  async addVariant(
    actor: Principal,
    id: string,
    input: { sku: string; options: Record<string, string>; weightGrams: number },
  ): Promise<Variant> {
    const product = await this.load(id);
    const variant = product.addVariant({ ...input, id: this.ids.uuid() }, this.clock.now());
    await this.products.save(product, this.audit(actor, 'catalogue.variant_added', 'product', id, { ...variant }));
    return variant;
  }

  async publish(actor: Principal, id: string): Promise<ProductState> {
    const product = await this.load(id);
    product.publish(await this.definitionsFor(product), this.clock.now());
    await this.products.save(product, this.audit(actor, 'catalogue.product_published', 'product', id));
    return product.snapshot;
  }

  async archive(actor: Principal, id: string): Promise<ProductState> {
    const product = await this.load(id);
    product.archive(this.clock.now());
    await this.products.save(product, this.audit(actor, 'catalogue.product_archived', 'product', id));
    return product.snapshot;
  }

  private async load(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) throw notFound('product');
    return product;
  }

  private async definitionsFor(product: Product) {
    return (await this.categories.findById(product.snapshot.categoryId))?.attributes ?? [];
  }

  private async assertBrand(brandId: string | null): Promise<void> {
    if (brandId && !(await this.brands.findById(brandId))) throw notFound('brand');
  }

  private editable(state: ProductState): Record<string, unknown> {
    return { name: state.name, description: state.description, brandId: state.brandId, attributes: state.attributes };
  }

  private audit(
    actor: Principal,
    action: string,
    targetType: string,
    targetId: string,
    after?: Record<string, unknown>,
    before?: Record<string, unknown>,
  ): AuditEntry {
    return { actorId: actor.accountId, action, targetType, targetId, after, before };
  }
}
