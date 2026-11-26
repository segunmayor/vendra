import { AuditEntry } from '../../../shared-kernel';
import { Issue } from '../domain/drafts';

export type { Issue } from '../domain/drafts';

export type ImportFormat = 'csv';
export type ImportMode = 'create_only' | 'create_and_update';
export type JobStatus = 'validated' | 'queued' | 'running' | 'completed' | 'cancelled';
export type ItemStatus = 'invalid' | 'ready' | 'skipped' | 'imported' | 'failed';
export type ItemAction = 'create' | 'update' | 'skip';

export const ITEM_STATUSES: readonly ItemStatus[] = ['invalid', 'ready', 'skipped', 'imported', 'failed'];

/** A variant as it will be applied: everything resolved to ids, money in kobo strings. */
export interface PlannedVariant {
  readonly line: number;
  readonly sku: string;
  readonly options: Readonly<Record<string, string>>;
  readonly weightGrams: number;
  readonly priceMinor: string;
  readonly compareAtMinor: string | null;
  readonly currency: string;
  readonly stock: number | null;
  readonly warehouseId: string | null;
}

/** A product as it will be applied. Null fields on an update mean "keep what is there". */
export interface PlannedProduct {
  readonly handle: string;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string;
  readonly brandId: string | null;
  /** A brand to create first (setting imports.createMissingBrands). */
  readonly brandToCreate: string | null;
  /** True when the file gave no brand, so an update keeps the current one. */
  readonly keepBrand: boolean;
  readonly status: 'published' | 'draft';
  /** Photo addresses to download; empty keeps the current photos. */
  readonly images: readonly string[];
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly variants: readonly PlannedVariant[];
}

export interface ImportSummary {
  readonly rows: number;
  readonly products: number;
  readonly variants: number;
  readonly creates: number;
  readonly updates: number;
}

export type ItemCounts = Readonly<Record<ItemStatus, number>>;

export interface ImportJobView {
  readonly id: string;
  readonly format: ImportFormat;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly mode: ImportMode;
  readonly status: JobStatus;
  /** File-level errors: if any, the job cannot be started. */
  readonly issues: readonly Issue[];
  /** File-level warnings, such as ignored columns. */
  readonly warnings: readonly Issue[];
  readonly summary: ImportSummary;
  readonly counts: ItemCounts;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface ImportItemView {
  readonly id: string;
  readonly position: number;
  readonly handle: string;
  readonly name: string;
  readonly lines: readonly number[];
  readonly skus: readonly string[];
  readonly action: ItemAction;
  readonly status: ItemStatus;
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
  readonly productId: string | null;
  readonly processedAt: Date | null;
}

export interface NewImportItem {
  readonly id: string;
  readonly position: number;
  readonly handle: string;
  readonly name: string;
  readonly lines: readonly number[];
  readonly skus: readonly string[];
  readonly action: ItemAction;
  readonly status: ItemStatus;
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
  readonly payload: PlannedProduct | null;
  readonly productId: string | null;
}

export interface NewImportJob {
  readonly id: string;
  readonly format: ImportFormat;
  readonly fileName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mode: ImportMode;
  readonly issues: readonly Issue[];
  readonly warnings: readonly Issue[];
  readonly summary: ImportSummary;
  readonly createdBy: string;
}

export interface ClaimedJob {
  readonly id: string;
  readonly mode: ImportMode;
  readonly createdBy: string;
}

export interface ImportRepository {
  create(job: NewImportJob, items: readonly NewImportItem[], audit: AuditEntry): Promise<void>;
  findJob(id: string): Promise<ImportJobView | null>;
  listJobs(query: { limit: number; before?: Date }): Promise<ImportJobView[]>;
  listItems(jobId: string, query: { status?: ItemStatus; limit: number; afterPosition?: number }): Promise<ImportItemView[]>;
  /** Moves the job between statuses, only if it is in one of `from`. Returns false otherwise. */
  transition(id: string, from: readonly JobStatus[], to: JobStatus, now: Date, audit: AuditEntry): Promise<boolean>;
  /** Takes a queued job, or a running one whose worker stopped, for `leaseMs`. Safe across processes. */
  claim(now: Date, leaseMs: number): Promise<ClaimedJob | null>;
  /** False when the job is no longer running (for example it was cancelled). */
  renewLease(id: string, until: Date): Promise<boolean>;
  nextReady(jobId: string): Promise<{ id: string; payload: PlannedProduct } | null>;
  recordItem(id: string, result: { status: ItemStatus; errors: readonly Issue[]; warnings: readonly Issue[]; productId: string | null }, now: Date): Promise<void>;
  /** Marks a running job completed. */
  complete(id: string, now: Date): Promise<void>;
}

export interface Hasher {
  sha256(bytes: Uint8Array): string;
}
