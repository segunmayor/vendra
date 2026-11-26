import { ApplicationError, DomainError, Principal } from '../../../shared-kernel';
import { extensionFor } from '../domain/location';
import { FileHolders } from './file-holders';
import { FileStorage } from './file-storage';
import { reason } from './locations';
import { FileHolder, FilePurpose, Hasher, HeldFile, LocationRepository, LocationState, MoveCursor, MoveJob, MoveProblem, MoveRepository, ObjectRepository } from './ports';

/** How long a worker holds a move between files. A crashed worker's move is resumed after this. */
export const MOVE_LEASE_MS = 2 * 60 * 1000;
const BATCH = 25;
/** Files copied at the same time, at most. Each holds its file in memory while it is copied. */
export const MAX_CONCURRENCY = 10;
/** In a row (in file order), without one success: the target is probably down, so the move stops instead of failing every file. */
const GIVE_UP_AFTER = 10;

export interface MoveSummary {
  readonly activeId: string | null;
  /** Files still in this server's database. */
  readonly database: { readonly files: number; readonly bytes: number };
  /** Files in storage locations other than the active one. */
  readonly otherLocations: { readonly files: number; readonly bytes: number };
  readonly running: MoveJob | null;
}

const notFound = () => new ApplicationError('not_found', 'storage.move_not_found', 'Move not found');

/**
 * Moves files that are not in the active location (still in the database, or in an earlier
 * location) into it, one at a time. Each copy is read back and compared before the owning record
 * is switched to it, so a file is never left without a working copy. Old copies are deleted only
 * after the switch, and in other locations only when staff ask for it.
 */
export class StorageMoveService {
  constructor(
    private readonly moves: MoveRepository,
    private readonly locations: LocationRepository,
    private readonly objects: ObjectRepository,
    private readonly holders: FileHolders,
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
  ) {}

  async summary(): Promise<MoveSummary> {
    const active = await this.locations.active();
    const inline = await Promise.all(this.holders.all().map((holder) => holder.inlineUsage()));
    const recent = await this.moves.recent(1);
    const open = recent[0] && (recent[0].status === 'queued' || recent[0].status === 'running') ? recent[0] : null;
    return {
      activeId: active?.id ?? null,
      database: inline.reduce((sum, usage) => ({ files: sum.files + usage.files, bytes: sum.bytes + usage.bytes }), { files: 0, bytes: 0 }),
      otherLocations: active ? await this.objects.countOutside(active.id) : { files: 0, bytes: 0 },
      running: open,
    };
  }

  recent(limit: number): Promise<MoveJob[]> {
    return this.moves.recent(limit);
  }

  async get(id: string): Promise<MoveJob> {
    const job = await this.moves.find(id);
    if (!job) throw notFound();
    return job;
  }

  /** Queues a move into the active location. Files keep working throughout. */
  async start(actor: Principal, input: { deleteOld: boolean; concurrency: number }): Promise<MoveJob> {
    if (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > MAX_CONCURRENCY) {
      throw new DomainError('storage.invalid', `Files at a time must be a whole number from 1 to ${MAX_CONCURRENCY}`);
    }
    const summary = await this.summary();
    const target = summary.activeId ? await this.locations.find(summary.activeId) : null;
    if (!target) throw new DomainError('storage.no_active_location', 'New files are kept in the database. Make a storage location active first, then move files into it.');
    const total = summary.database.files + summary.otherLocations.files;
    if (total === 0) throw new DomainError('storage.nothing_to_move', `Every file is already in ${target.name}.`);
    const id = this.ids.uuid();
    const created = await this.moves.create(
      { id, targetLocationId: target.id, deleteOld: input.deleteOld, concurrency: input.concurrency, total, createdBy: actor.accountId },
      { actorId: actor.accountId, action: 'storage.move_started', targetType: 'storage_move', targetId: id, after: { target: target.name, deleteOld: input.deleteOld, concurrency: input.concurrency, total } },
    );
    if (!created) throw new DomainError('storage.move_running', 'Files are already being moved. Wait for that to finish, or stop it.');
    return this.get(id);
  }

  async cancel(actor: Principal, id: string): Promise<MoveJob> {
    await this.get(id);
    const stopped = await this.moves.cancel(id, this.clock.now(), { actorId: actor.accountId, action: 'storage.move_cancelled', targetType: 'storage_move', targetId: id });
    if (!stopped) throw new DomainError('storage.move_finished', 'This move has already finished.');
    return this.get(id);
  }
}

interface RunState {
  counts: { moved: number; skipped: number; failed: number; movedBytes: number };
  cursor: MoveCursor;
  failuresInARow: number;
  lastProblem: string | null;
}

type Outcome = { kind: 'moved'; bytes: number } | { kind: 'skipped' } | { kind: 'failed'; message: string };

/** Does the work of queued moves. Several API instances can poll; only one takes each job. */
export class StorageMoveRunner {
  constructor(
    private readonly moves: MoveRepository,
    private readonly locations: LocationRepository,
    private readonly files: FileStorage,
    private readonly holders: FileHolders,
    private readonly hasher: Hasher,
    private readonly clock: { now(): Date },
    private readonly log: { error(message: string): void },
  ) {}

  /** Runs one job to the end (or until stopped), if any is waiting. Returns whether it found one. */
  async runOnce(): Promise<boolean> {
    const job = await this.moves.claim(this.clock.now(), MOVE_LEASE_MS);
    if (!job) return false;
    const state: RunState = {
      counts: { moved: job.moved, skipped: job.skipped, failed: job.failed, movedBytes: job.movedBytes },
      cursor: job.cursor,
      failuresInARow: 0,
      lastProblem: null,
    };
    const holders = this.holders.all();

    while (state.cursor.holder < holders.length) {
      const target = await this.locations.find(job.targetLocationId);
      if (!target || !target.active) {
        await this.moves.finish(job.id, 'cancelled', 'Stopped because another place was chosen for new files. Start a new move to continue.', this.clock.now());
        return true;
      }
      const holder = holders[state.cursor.holder]!;
      const batch = await holder.scan(state.cursor.after, Math.max(BATCH, job.concurrency * 5));
      if (batch.length === 0) {
        state.cursor = { holder: state.cursor.holder + 1, after: null };
        if (!(await this.moves.progress(job.id, { ...state.counts, cursor: state.cursor }, this.leaseUntil()))) return true;
        continue;
      }
      const result = await this.runBatch(job, holder, target, batch, state);
      if (result === 'stopped') return true;
      if (result === 'gave-up') {
        await this.moves.finish(job.id, 'failed', `Stopped after ${GIVE_UP_AFTER} files in a row could not be moved. Last reason: ${state.lastProblem ?? 'unknown'}`, this.clock.now());
        return true;
      }
    }
    const { failed } = state.counts;
    await this.moves.finish(job.id, 'completed', failed > 0 ? `${failed} files could not be moved. They still work where they are; start another move to retry them.` : null, this.clock.now());
    return true;
  }

  /**
   * Moves a batch with up to `job.concurrency` files in flight. Outcomes are recorded in file
   * order: the saved position only passes a file once every file before it is done, so a restart
   * never skips one. Files finished out of order wait for the ones before them.
   */
  private async runBatch(job: MoveJob, holder: FileHolder, target: LocationState, batch: readonly HeldFile[], state: RunState): Promise<'continue' | 'stopped' | 'gave-up'> {
    const outcomes: (Outcome | undefined)[] = new Array(batch.length);
    let next = 0;
    let recorded = 0;
    let stop: 'stopped' | 'gave-up' | null = null;
    let saving: Promise<void> = Promise.resolve();

    const record = async (): Promise<void> => {
      const problems: MoveProblem[] = [];
      const from = recorded;
      while (recorded < batch.length && outcomes[recorded] && !stop) {
        const outcome = outcomes[recorded]!;
        const file = batch[recorded]!;
        recorded++;
        if (outcome.kind === 'moved') {
          state.counts = { ...state.counts, moved: state.counts.moved + 1, movedBytes: state.counts.movedBytes + outcome.bytes };
          state.failuresInARow = 0;
        } else if (outcome.kind === 'skipped') {
          state.counts = { ...state.counts, skipped: state.counts.skipped + 1 };
        } else {
          state.counts = { ...state.counts, failed: state.counts.failed + 1 };
          state.failuresInARow++;
          state.lastProblem = outcome.message;
          problems.unshift({ at: this.clock.now(), purpose: holder.purpose, rowId: file.rowId, message: outcome.message });
        }
        if (state.failuresInARow >= GIVE_UP_AFTER) stop = 'gave-up';
      }
      if (recorded === from) return;
      state.cursor = { holder: state.cursor.holder, after: batch[recorded - 1]!.rowId };
      // False: staff stopped the move.
      const running = await this.moves.progress(job.id, { ...state.counts, cursor: state.cursor, ...(problems.length ? { problems } : {}) }, this.leaseUntil());
      if (!running) stop = 'stopped';
    };

    const worker = async (): Promise<void> => {
      while (!stop && next < batch.length) {
        const index = next++;
        outcomes[index] = await this.moveOne(holder.purpose, batch[index]!, target, job.deleteOld, holder);
        // One save at a time, in order.
        saving = saving.then(record);
        await saving;
      }
    };
    await Promise.all(Array.from({ length: Math.min(job.concurrency, batch.length) }, worker));
    await saving;
    return stop ?? 'continue';
  }

  private leaseUntil(): Date {
    return new Date(this.clock.now().getTime() + MOVE_LEASE_MS);
  }

  private async moveOne(purpose: FilePurpose, file: HeldFile, target: LocationState, deleteOld: boolean, holder: FileHolder): Promise<Outcome> {
    try {
      if (file.objectId && (await this.files.locationOf(file.objectId)) === target.id) return { kind: 'skipped' };
      const content = file.objectId ? await this.files.get(file.objectId) : await holder.readInline(file.rowId);
      if (!content) return { kind: 'failed', message: 'The file is missing where it was stored.' };
      if (this.hasher.sha256(content) !== file.sha256) return { kind: 'failed', message: 'The stored file does not match its checksum, so it was left where it is.' };

      const copy = await this.files.putIn(target, { purpose, contentType: file.contentType, extension: extensionFor(file.contentType), content, sha256: file.sha256 });
      // Read back before switching: the record only ever points at a copy known to be whole.
      const back = await this.files.get(copy.objectId).catch(() => null);
      if (!back || this.hasher.sha256(back) !== file.sha256) {
        await this.files.remove(copy.objectId).catch(() => undefined);
        return { kind: 'failed', message: `The copy in ${target.name} did not match the original, so the original was kept.` };
      }
      if (!(await holder.repoint(file.rowId, file.objectId, copy.objectId))) {
        // Deleted or replaced while it was being copied: the copy is not needed.
        await this.files.remove(copy.objectId).catch(() => undefined);
        return { kind: 'skipped' };
      }
      if (file.objectId) {
        // The old copy is no longer used either way. Kept if staff asked, or if deleting it fails.
        const keep = () => this.files.supersede(file.objectId!);
        if (!deleteOld) await keep();
        else
          await this.files.remove(file.objectId).catch(async (error: unknown) => {
            this.log.error(`Moved file ${file.rowId}, but the old copy was kept: ${reason(error)}`);
            await keep();
          });
      }
      return { kind: 'moved', bytes: content.length };
    } catch (error) {
      if (!(error instanceof ApplicationError || error instanceof DomainError)) this.log.error(`Moving ${purpose} ${file.rowId}: ${error instanceof Error ? error.message : String(error)}`);
      return { kind: 'failed', message: reason(error) };
    }
  }
}
