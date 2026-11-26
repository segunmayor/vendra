import type { AuditEntry } from '../../../shared-kernel';
import type { DriverKind, FilePurpose, LocationCheck, LocationState } from '../domain/location';

export type { DriverKind, FieldSpec, FilePurpose, LocationCheck, LocationState, StorageType } from '../domain/location';

/** One storage service account, with its credentials already decrypted. */
export interface StorageDriver {
  put(key: string, content: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** Releases connections. Called when a location's settings change. */
  close?(): Promise<void>;
}

export interface DriverFactory {
  create(driver: DriverKind, type: string, config: Readonly<Record<string, string>>, secrets: Readonly<Record<string, string>>): StorageDriver;
}

/** A failure talking to a storage service, with a reason staff can act on. */
export class StorageUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailable';
  }
}

export interface LocationUsage {
  readonly files: number;
  readonly bytes: number;
}

export interface LocationRepository {
  list(): Promise<LocationState[]>;
  find(id: string): Promise<LocationState | null>;
  active(): Promise<LocationState | null>;
  sealedSecrets(id: string): Promise<string | null>;
  usage(): Promise<Map<string, LocationUsage>>;
  /** Throws ConcurrencyConflict if the location changed since it was read. */
  save(state: LocationState, sealedSecrets: string | null, isNew: boolean, audit: AuditEntry): Promise<void>;
  recordCheck(id: string, check: LocationCheck): Promise<void>;
  /** Makes one location active, or none (files then stay in the database). */
  activate(id: string | null, audit: AuditEntry): Promise<void>;
  /** Removes a location with no files in use (copies kept after a move are forgotten). False if it holds files or is active. */
  remove(id: string, audit: AuditEntry): Promise<boolean>;
}

export interface StoredObject {
  readonly id: string;
  readonly locationId: string;
  readonly key: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface ObjectRepository {
  add(object: StoredObject & { sha256: string; purpose: FilePurpose }): Promise<void>;
  find(id: string): Promise<StoredObject | null>;
  remove(id: string): Promise<void>;
  /** Marks a copy no record uses any more (kept after a move). */
  supersede(id: string, at: Date): Promise<void>;
  /** Files in use in other locations: these still need moving into the given one. */
  countOutside(locationId: string): Promise<{ files: number; bytes: number }>;
}

export interface SecretSealer {
  seal(plaintext: string): string;
  open(sealed: string): string;
}

// ---------- moving files between locations ----------

/** One file as the module that owns it records it. */
export interface HeldFile {
  /** The owning row, such as a product photo or seller document. */
  readonly rowId: string;
  /** Null while the bytes are in the owning row (the database). */
  readonly objectId: string | null;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/**
 * Implemented by each module that keeps files, so files can be moved without the storage module
 * reading other modules' tables. Registered with FileHolders when the application starts.
 */
export interface FileHolder {
  readonly purpose: FilePurpose;
  /** Every file, in row id order, after the given row. */
  scan(afterRowId: string | null, limit: number): Promise<HeldFile[]>;
  /** Files whose bytes are still in the database. */
  inlineUsage(): Promise<{ files: number; bytes: number }>;
  readInline(rowId: string): Promise<Uint8Array | null>;
  /**
   * Points the row at a stored object, clearing any bytes it held, but only if it still points
   * where it did (`from`, or the database when null). False if it changed or was deleted meanwhile.
   */
  repoint(rowId: string, from: string | null, to: string): Promise<boolean>;
}

export type MoveStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface MoveProblem {
  readonly at: Date;
  readonly purpose: string;
  readonly rowId: string;
  readonly message: string;
}

export interface MoveCursor {
  /** Index into the registered holders. */
  readonly holder: number;
  readonly after: string | null;
}

export interface MoveJob {
  readonly id: string;
  readonly targetLocationId: string;
  readonly status: MoveStatus;
  readonly deleteOld: boolean;
  readonly total: number;
  readonly moved: number;
  readonly skipped: number;
  readonly failed: number;
  readonly movedBytes: number;
  readonly cursor: MoveCursor;
  readonly problems: readonly MoveProblem[];
  readonly message: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface MoveProgress {
  readonly moved: number;
  readonly skipped: number;
  readonly failed: number;
  readonly movedBytes: number;
  readonly cursor: MoveCursor;
  readonly problem?: MoveProblem;
}

export interface MoveRepository {
  /** False if a move is already queued or running. */
  create(job: Pick<MoveJob, 'id' | 'targetLocationId' | 'deleteOld' | 'total' | 'createdBy'>, audit: AuditEntry): Promise<boolean>;
  find(id: string): Promise<MoveJob | null>;
  recent(limit: number): Promise<MoveJob[]>;
  /** Takes a queued job, or a running one whose worker stopped renewing its lease. */
  claim(now: Date, leaseMs: number): Promise<MoveJob | null>;
  /** Records progress and extends the lease. False if the job is no longer running (stopped by staff). */
  progress(id: string, progress: MoveProgress, leaseUntil: Date): Promise<boolean>;
  finish(id: string, status: Exclude<MoveStatus, 'queued' | 'running'>, message: string | null, now: Date): Promise<void>;
  /** Stops a queued or running job. False if it had already ended. */
  cancel(id: string, now: Date, audit: AuditEntry): Promise<boolean>;
}

/** sha256 of file contents, as lower-case hex. */
export interface Hasher {
  sha256(bytes: Uint8Array): string;
}
