import { ApplicationError, AuditEntry, DomainError, Principal } from '../../../shared-kernel';
import { assertName, parseAttributeSchema, toSlug } from '../domain/attributes';
import { MAX_IMAGES, MAX_VIDEOS, Product, ProductDetails, ProductState, ProductStatus, Variant } from '../domain/product';
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

export { MAX_IMAGES, MAX_VIDEOS };

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

  async findProductBySlug(slug: string): Promise<ProductState | null> {
    return (await this.products.findBySlug(slug))?.snapshot ?? null;
  }

  /** Which product already uses each SKU, so an import can tell a clash from its own variant. */
  skuOwners(skus: readonly string[]): Promise<Map<string, string>> {
    return this.products.skuOwners(skus.map((sku) => sku.trim().toUpperCase()));
  }

  /** Refuses before a photo is downloaded or stored when the product already has the most allowed. */
  async assertRoomForImage(id: string): Promise<void> {
    const product = await this.load(id);
    if (product.snapshot.images.length >= MAX_IMAGES) {
      throw new DomainError('product.too_many_images', `A product can have at most ${MAX_IMAGES} photos. Remove one first.`);
    }
  }

  /** Adds a photo after the others. A photo the product already has is left where it is. */
  async addImage(actor: Principal, id: string, image: string): Promise<ProductState> {
    const product = await this.load(id);
    return this.setImages(actor, id, [...product.snapshot.images, image]);
  }

  /** Reorders or removes photos. Only photos the product already has may be listed. */
  async arrangeImages(actor: Principal, id: string, images: readonly string[]): Promise<ProductState> {
    const product = await this.load(id);
    const current = new Set(product.snapshot.images);
    if (images.some((image) => !current.has(image))) {
      throw new DomainError('product.unknown_image', 'The photos changed while you were editing. Reload the page and try again.');
    }
    return this.setImages(actor, id, images);
  }

  /** Refuses before a video is stored when the product already has the most allowed. */
  async assertRoomForVideo(id: string, limit: number): Promise<void> {
    const product = await this.load(id);
    const max = Math.min(limit, MAX_VIDEOS);
    if (max === 0) throw new DomainError('product.videos_off', 'Product videos are turned off in Settings.');
    if (product.snapshot.videos.length >= max) throw new DomainError('product.too_many_videos', `A product can have at most ${max} videos. Remove one first.`);
  }

  async addVideo(actor: Principal, id: string, video: string): Promise<ProductState> {
    const product = await this.load(id);
    return this.setVideos(actor, id, [...product.snapshot.videos, video]);
  }

  /** Reorders or removes videos. Only videos the product already has may be listed. */
  async arrangeVideos(actor: Principal, id: string, videos: readonly string[]): Promise<ProductState> {
    const product = await this.load(id);
    const current = new Set(product.snapshot.videos);
    if (videos.some((video) => !current.has(video))) {
      throw new DomainError('product.unknown_video', 'The videos changed while you were editing. Reload the page and try again.');
    }
    return this.setVideos(actor, id, videos);
  }

  private async setVideos(actor: Principal, id: string, videos: readonly string[]): Promise<ProductState> {
    const product = await this.load(id);
    const before = product.snapshot.videos;
    product.setVideos(videos, this.clock.now());
    if (product.snapshot.videos === before) return product.snapshot;
    await this.products.save(
      product,
      this.audit(actor, 'catalogue.product_videos_set', 'product', id, { videos: [...product.snapshot.videos] }, { videos: [...before] }),
    );
    return product.snapshot;
  }

  async setImages(actor: Principal, id: string, images: readonly string[]): Promise<ProductState> {
    const product = await this.load(id);
    const before = product.snapshot.images;
    product.setImages(images, this.clock.now());
    if (product.snapshot.images === before) return product.snapshot;
    await this.products.save(
      product,
      this.audit(actor, 'catalogue.product_images_set', 'product', id, { images: [...product.snapshot.images] }, { images: [...before] }),
    );
    return product.snapshot;
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
