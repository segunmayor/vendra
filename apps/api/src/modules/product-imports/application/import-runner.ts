import { ApplicationError, DomainError, Principal } from '../../../shared-kernel';
import { Issue } from '../domain/drafts';
import { CatalogueService, InventoryService, ListingService, ProductMediaService, ProductState, SettingsReader } from './contracts';
import { ClaimedJob, ImportMode, ImportRepository, PlannedProduct } from './ports';

/** How long a worker holds a job between products. A crashed worker's job is resumed after this. */
export const LEASE_MS = 2 * 60 * 1000;

interface RunSettings {
  readonly requireImage: boolean;
  readonly limits: { readonly maxBytes: number; readonly timeoutMs: number; readonly allowHttp: boolean };
}

/** An error staff can act on, or null for a fault in the system (logged, shown as a generic message). */
const plainMessage = (error: unknown): string | null =>
  error instanceof DomainError || error instanceof ApplicationError ? error.message : null;

/**
 * Applies queued imports, one product at a time. Every step finds what already exists before
 * creating anything, so a product interrupted half way (crash, deploy) is finished correctly
 * when the job is resumed, and importing the same file twice changes nothing the second time.
 */
export class ImportRunner {
  constructor(
    private readonly imports: ImportRepository,
    private readonly catalogue: CatalogueService,
    private readonly media: ProductMediaService,
    private readonly listings: ListingService,
    private readonly inventory: InventoryService,
    private readonly settings: SettingsReader,
    private readonly clock: { now(): Date },
    private readonly log: { error(message: string): void },
  ) {}

  /** Processes one job to the end, if any is waiting. Returns whether it found one. */
  async runOnce(): Promise<boolean> {
    const job = await this.imports.claim(this.clock.now(), LEASE_MS);
    if (!job) return false;
    const settings = await this.loadSettings();
    for (;;) {
      if (!(await this.imports.renewLease(job.id, new Date(this.clock.now().getTime() + LEASE_MS)))) return true;
      const item = await this.imports.nextReady(job.id);
      if (!item) break;
      const result = await this.applySafely(job, item.payload, settings);
      await this.imports.recordItem(item.id, result, this.clock.now());
    }
    await this.imports.complete(job.id, this.clock.now());
    return true;
  }

  private async loadSettings(): Promise<RunSettings> {
    const [requireImage, maxImageMb, timeoutSeconds, allowHttp] = await this.settings.getMany([
      'imports.requireImageToPublish',
      'imports.maxImageMb',
      'imports.imageTimeoutSeconds',
      'imports.allowHttpImages',
    ] as const);
    return { requireImage, limits: { maxBytes: maxImageMb * 1024 * 1024, timeoutMs: timeoutSeconds * 1000, allowHttp } };
  }

  private async applySafely(job: ClaimedJob, plan: PlannedProduct, settings: RunSettings) {
    const warnings: Issue[] = [];
    const progress = { productId: null as string | null };
    try {
      const outcome = await this.apply(job, plan, settings, warnings, progress);
      return { status: outcome, errors: [], warnings, productId: progress.productId };
    } catch (error) {
      const message = plainMessage(error);
      if (!message) this.log.error(`Import ${job.id}, product ${plan.handle}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      const saved = progress.productId ? ' What was saved so far is kept; fix the row and import the file again to finish it.' : '';
      return {
        status: 'failed' as const,
        errors: [{ line: plan.variants[0]?.line ?? null, field: null, message: `${message ?? 'Something went wrong on our side while importing this product.'}${saved}` }],
        warnings,
        productId: progress.productId,
      };
    }
  }

  private async apply(job: ClaimedJob, plan: PlannedProduct, settings: RunSettings, warnings: Issue[], progress: { productId: string | null }): Promise<'imported' | 'skipped'> {
    const actor: Principal = { accountId: job.createdBy, sessionId: job.id, audience: 'admin', permissions: [] };
    const firstLine = plan.variants[0]?.line ?? null;

    const brandId = plan.brandToCreate ? await this.brand(actor, plan.brandToCreate) : plan.brandId;

    let product = await this.catalogue.findProductBySlug(plan.handle);
    if (product && job.mode === ('create_only' satisfies ImportMode)) {
      warnings.push({ line: firstLine, field: 'handle', message: `A product with the handle "${plan.handle}" was created after the file was checked, so it was left as it is.` });
      progress.productId = product.id;
      return 'skipped';
    }
    if (!product) {
      product = await this.catalogue.createProduct(actor, {
        categoryId: plan.categoryId,
        slug: plan.handle,
        name: plan.name,
        description: plan.description ?? '',
        brandId,
        attributes: plan.attributes,
      });
    } else {
      product = await this.catalogue.updateProduct(actor, product.id, {
        name: plan.name,
        description: plan.description ?? product.description,
        brandId: plan.keepBrand ? product.brandId : brandId,
        attributes: { ...product.attributes, ...plan.attributes },
      });
    }
    progress.productId = product.id;

    if (plan.images.length) product = await this.photos(actor, product, plan, settings, warnings);

    for (const variant of plan.variants) {
      if (!product.variants.some((existing) => existing.sku === variant.sku)) {
        await this.catalogue.addVariant(actor, product.id, { sku: variant.sku, options: { ...variant.options }, weightGrams: variant.weightGrams });
      }
    }
    product = await this.catalogue.getProduct(product.id);

    if (plan.status === 'published' && product.status === 'draft') {
      if (settings.requireImage && product.images.length === 0) {
        warnings.push({ line: firstLine, field: 'images', message: 'Saved as a draft because it has no photo. Add one, then publish it in Products.' });
      } else {
        product = await this.catalogue.publish(actor, product.id);
      }
    }
    if (product.status === 'archived') {
      warnings.push({ line: firstLine, field: 'status', message: 'This product is archived, so it stays off sale. Prices and stock were still updated.' });
    }

    const listings = new Map((await this.listings.listForProduct(product.id)).map((listing) => [listing.variantId, listing]));
    const variantIds = new Map(product.variants.map((variant) => [variant.sku, variant.id]));
    const listingIds = new Map<string, string>();
    for (const variant of plan.variants) {
      const variantId = variantIds.get(variant.sku)!;
      const price = { priceMinor: variant.priceMinor, currency: variant.currency, compareAtMinor: variant.compareAtMinor };
      let listing = listings.get(variantId);
      listing = listing ? await this.listings.changePrice(actor, listing.id, price) : await this.listings.create(actor, { ...price, variantId });
      if (product.status === 'published' && plan.status === 'published' && listing.status !== 'active') {
        listing = await this.listings.activate(actor, listing.id);
      }
      listingIds.set(variant.sku, listing.id);
    }

    const withStock = plan.variants.filter((variant) => variant.stock !== null && variant.warehouseId);
    if (withStock.length) {
      const stock = await this.inventory.stockForProduct(product.id);
      for (const variant of withStock) {
        const listingId = listingIds.get(variant.sku)!;
        const current = stock.find((row) => row.listingId === listingId && row.warehouseId === variant.warehouseId);
        const delta = variant.stock! - (current?.onHand ?? 0);
        if (delta === 0) continue;
        await this.inventory.adjust(actor, {
          listingId,
          warehouseId: variant.warehouseId!,
          delta,
          reason: delta > 0 && !current ? 'receipt' : 'correction',
          // One key per job and SKU: a resumed job never applies the same change twice.
          idempotencyKey: `import:${job.id}:${variant.sku}`,
        });
      }
    }
    return 'imported';
  }

  /** Downloads each photo; one that fails is skipped with a warning, the rest are used. */
  private async photos(actor: Principal, product: ProductState, plan: PlannedProduct, settings: RunSettings, warnings: Issue[]): Promise<ProductState> {
    const stored: string[] = [];
    const line = plan.variants[0]?.line ?? null;
    for (const url of plan.images) {
      try {
        stored.push(await this.media.importFromUrl(url, settings.limits));
      } catch (error) {
        const message = plainMessage(error);
        if (!message) this.log.error(`Photo ${url}: ${error instanceof Error ? error.message : String(error)}`);
        warnings.push({ line, field: 'images', message: `Photo ${shorten(url)} was skipped: ${message ?? 'it could not be downloaded'}` });
      }
    }
    if (stored.length === 0) {
      if (product.images.length) warnings.push({ line, field: 'images', message: 'No new photo could be used, so the current photos were kept' });
      return product;
    }
    return this.catalogue.setImages(actor, product.id, stored);
  }

  private async brand(actor: Principal, name: string): Promise<string> {
    const find = async () => (await this.catalogue.listBrands()).find((brand) => brand.name.toLowerCase() === name.toLowerCase());
    const existing = await find();
    if (existing) return existing.id;
    try {
      return (await this.catalogue.createBrand(actor, name)).id;
    } catch (error) {
      // Created by an earlier product in this file, or by someone else just now.
      const created = await find();
      if (created) return created.id;
      throw error;
    }
  }
}

const shorten = (url: string) => (url.length > 80 ? `${url.slice(0, 77)}…` : url);
