import { ApplicationError, AuditEntry, DomainError, Principal } from '../../../shared-kernel';
import { COLUMNS } from '../domain/columns';
import { csvLine } from '../domain/csv';
import { decodeText, readCsvSource } from '../domain/csv-source';
import { buildDrafts, Issue } from '../domain/drafts';
import { CatalogueService, InventoryService, ProductState, SettingsReader } from './contracts';
import { planImport } from './plan';
import {
  Hasher,
  ImportItemView,
  ImportJobView,
  ImportMode,
  ImportRepository,
  ItemStatus,
  NewImportItem,
} from './ports';

/** Hard ceiling whatever the setting says: the upload is held in memory while it is checked. */
export const IMPORT_HARD_LIMIT_BYTES = 20 * 1024 * 1024;

const notFound = () => new ApplicationError('not_found', 'import.not_found', 'Import not found');

/**
 * Bulk product uploads in two steps. Upload checks the whole file and stores what would
 * happen to each product, changing nothing. Start queues the products that passed; the
 * runner then applies them one at a time through the catalogue, listings and inventory
 * contracts, so every business rule and audit entry is the same as for a manual change.
 */
export class ProductImportService {
  constructor(
    private readonly imports: ImportRepository,
    private readonly catalogue: CatalogueService,
    private readonly inventory: InventoryService,
    private readonly settings: SettingsReader,
    private readonly hasher: Hasher,
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
  ) {}

  async upload(actor: Principal, input: { fileName: string; content: Uint8Array; mode: ImportMode }): Promise<ImportJobView> {
    const [maxFileMb, maxRows, maxImages, createMissingBrands] = await this.settings.getMany([
      'imports.maxFileMb',
      'imports.maxRows',
      'imports.maxImagesPerProduct',
      'imports.createMissingBrands',
    ] as const);
    const limit = Math.min(maxFileMb * 1024 * 1024, IMPORT_HARD_LIMIT_BYTES);
    if (input.content.length === 0) throw new DomainError('import.empty', 'That file is empty');
    if (input.content.length > limit) throw new DomainError('import.too_large', `Product files can be up to ${Math.floor(limit / (1024 * 1024))} MB`);
    const fileName = cleanName(input.fileName);
    if (!/\.(csv|txt)$/i.test(fileName)) throw new DomainError('import.unsupported_format', 'Upload a .csv file. JSON and XML are coming later.');
    if (input.content.subarray(0, 8000).includes(0)) throw new DomainError('import.not_text', 'That file is not a CSV text file. In your spreadsheet, choose Save As, then "CSV UTF-8".');

    const { text, warning } = decodeText(input.content);
    const source = readCsvSource(text, maxRows);
    const fileWarnings: Issue[] = [...source.warnings];
    if (warning) fileWarnings.unshift({ line: null, field: null, message: warning });
    const { drafts, issues } = buildDrafts(source.records, { maxImages });
    const fileErrors = [...source.errors, ...issues];
    if (!fileErrors.length && drafts.length === 0) fileErrors.push({ line: null, field: null, message: 'The file has a header row but no products' });

    const handles = drafts.map((draft) => draft.handle);
    const skus = drafts.flatMap((draft) => draft.variants.map((variant) => variant.sku));
    const [categories, brands, warehouses, skuOwners, existing] = await Promise.all([
      this.catalogue.listCategories(),
      this.catalogue.listBrands(),
      this.inventory.listWarehouses(),
      this.catalogue.skuOwners(skus),
      this.existingProducts(handles),
    ]);
    const planned = planImport(drafts, { mode: input.mode, categories, brands, warehouses, existing, skuOwners, createMissingBrands });

    const job = {
      id: this.ids.uuid(),
      format: 'csv' as const,
      fileName,
      sha256: this.hasher.sha256(input.content),
      sizeBytes: input.content.length,
      mode: input.mode,
      issues: fileErrors,
      warnings: fileWarnings,
      summary: {
        rows: source.records.length,
        products: planned.length,
        variants: planned.reduce((sum, item) => sum + item.lines.length, 0),
        creates: planned.filter((item) => item.status === 'ready' && item.action === 'create').length,
        updates: planned.filter((item) => item.status === 'ready' && item.action === 'update').length,
      },
      createdBy: actor.accountId,
    };
    const items: NewImportItem[] = planned.map((item, position) => ({ ...item, id: this.ids.uuid(), position }));
    await this.imports.create(job, items, this.audit(actor, 'catalogue.import_uploaded', job.id, { fileName, mode: input.mode, ...job.summary }));
    return this.get(job.id);
  }

  async get(id: string): Promise<ImportJobView> {
    const job = await this.imports.findJob(id);
    if (!job) throw notFound();
    return job;
  }

  list(query: { limit: number; before?: Date }): Promise<ImportJobView[]> {
    return this.imports.listJobs(query);
  }

  async items(id: string, query: { status?: ItemStatus; limit: number; afterPosition?: number }): Promise<ImportItemView[]> {
    await this.get(id);
    return this.imports.listItems(id, query);
  }

  /** Queues the products that passed the checks. Those that did not are left out. */
  async start(actor: Principal, id: string): Promise<ImportJobView> {
    const job = await this.get(id);
    if (job.issues.length) throw new DomainError('import.has_file_errors', 'Fix the problems with the file and upload it again');
    if (job.status !== 'validated') throw new DomainError('import.already_started', 'This import has already been started');
    if (job.counts.ready === 0) throw new DomainError('import.nothing_to_import', 'No product in this file passed the checks');
    const moved = await this.imports.transition(id, ['validated'], 'queued', this.clock.now(), this.audit(actor, 'catalogue.import_started', id, { ready: job.counts.ready }));
    if (!moved) throw new DomainError('import.already_started', 'This import has already been started');
    return this.get(id);
  }

  /** Stops before the next product. Products already imported stay imported. */
  async cancel(actor: Principal, id: string): Promise<ImportJobView> {
    await this.get(id);
    const moved = await this.imports.transition(id, ['validated', 'queued', 'running'], 'cancelled', this.clock.now(), this.audit(actor, 'catalogue.import_cancelled', id));
    if (!moved) throw new DomainError('import.finished', 'This import has already finished');
    return this.get(id);
  }

  /** Every problem and warning, one per line, for fixing in a spreadsheet. */
  async report(id: string): Promise<{ fileName: string; content: string }> {
    const job = await this.get(id);
    const lines = [csvLine(['row', 'handle', 'name', 'skus', 'result', 'severity', 'column', 'message'])];
    for (const issue of job.issues) lines.push(csvLine([issue.line, '', '', '', 'file', 'error', issue.field, issue.message]));
    for (const issue of job.warnings) lines.push(csvLine([issue.line, '', '', '', 'file', 'warning', issue.field, issue.message]));
    let afterPosition: number | undefined;
    for (;;) {
      const page = await this.imports.listItems(id, { limit: 500, afterPosition });
      for (const item of page) {
        const row = (issue: Issue) => issue.line ?? item.lines[0] ?? '';
        const common = (issue: Issue) => [row(issue), item.handle, item.name, item.skus.join(' '), item.status];
        for (const issue of item.errors) lines.push(csvLine([...common(issue), 'error', issue.field, issue.message]));
        for (const issue of item.warnings) lines.push(csvLine([...common(issue), 'warning', issue.field, issue.message]));
      }
      if (page.length < 500) break;
      afterPosition = page.at(-1)!.position;
    }
    const base = job.fileName.replace(/\.[^.]*$/, '');
    // The BOM makes Excel open the report as UTF-8.
    return { fileName: `${base}-problems.csv`, content: `﻿${lines.join('\r\n')}\r\n` };
  }

  private async existingProducts(handles: readonly string[]): Promise<Map<string, ProductState>> {
    const found = new Map<string, ProductState>();
    for (let index = 0; index < handles.length; index += 50) {
      const batch = await Promise.all(handles.slice(index, index + 50).map((handle) => this.catalogue.findProductBySlug(handle)));
      for (const product of batch) if (product) found.set(product.slug, product);
    }
    return found;
  }

  private audit(actor: Principal, action: string, targetId: string, after?: Record<string, unknown>): AuditEntry {
    return { actorId: actor.accountId, action, targetType: 'product_import', targetId, after };
  }
}

/** Keeps letters, numbers and simple punctuation from the uploaded name. */
function cleanName(name: string): string {
  return (
    name
      .split(/[\\/]/)
      .pop()!
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N} ._()-]+/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'products.csv'
  );
}

/** The column reference and a template, from the same definitions the reader uses. */
export function importTemplate(): string {
  const header = [
    'handle', 'name', 'description', 'category', 'brand', 'status', 'images', 'sku', 'option1_name', 'option1_value',
    'price', 'sale_price', 'discount_percent', 'weight_grams', 'stock', 'warehouse', 'attr:screen_size',
  ];
  const rows = [
    ['nova-x5-smartphone', 'Nova X5 Smartphone', '6.5 inch display, dual SIM, 5000 mAh battery.', 'Smartphones', 'Nova Mobile', 'published',
      'https://example.com/photos/nova-x5-front.jpg | https://example.com/photos/nova-x5-back.jpg', 'NOVA-X5-128', 'Storage', '128 GB',
      '215000', '185000', '', '450', '25', 'Lagos warehouse', '6.5'],
    ['nova-x5-smartphone', '', '', '', '', '', '', 'NOVA-X5-256', 'Storage', '256 GB', '245000', '', '10', '450', '10', 'Lagos warehouse', ''],
    ['', 'Shea Butter Body Cream 250ml', 'Unscented shea butter cream.', 'Beauty & Health', 'Eko Naturals', 'draft',
      'https://example.com/photos/shea-250.jpg', 'SHEA-250', '', '', '4500', '', '', '300', '50', '', ''],
  ];
  return `﻿${[header, ...rows].map(csvLine).join('\r\n')}\r\n`;
}

export const IMPORT_COLUMNS = COLUMNS;
