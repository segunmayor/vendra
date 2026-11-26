import { createHash } from 'node:crypto';
import { Principal } from '../../../shared-kernel';
import { LocationState } from '../domain/location';
import { DriverPool } from './drivers';
import { FileHolders } from './file-holders';
import { FileStorage } from './file-storage';
import { StorageMoveRunner, StorageMoveService } from './moves';
import {
  DriverFactory,
  FileHolder,
  HeldFile,
  LocationRepository,
  MoveJob,
  MoveProgress,
  MoveRepository,
  ObjectRepository,
  StorageDriver,
  StoredObject,
  StorageUnavailable,
} from './ports';

const actor: Principal = { accountId: '11111111-1111-4111-8111-111111111111', sessionId: 's', audience: 'admin', permissions: ['settings.manage'] };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = (text: string) => new Uint8Array(Buffer.from(text));

class Bucket implements StorageDriver {
  readonly files = new Map<string, Uint8Array>();
  failPut: string | null = null;
  corrupt = false;
  /** Milliseconds each upload takes, by content; lets tests finish files out of order. */
  delay: (content: Uint8Array) => number = () => 0;
  inFlight = 0;
  mostInFlight = 0;
  async put(key: string, content: Uint8Array) {
    this.inFlight++;
    this.mostInFlight = Math.max(this.mostInFlight, this.inFlight);
    try {
      const wait = this.delay(content);
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    } finally {
      this.inFlight--;
    }
    if (this.failPut) throw new StorageUnavailable(this.failPut);
    this.files.set(key, this.corrupt ? bytes('garbage') : content);
  }
  async get(key: string) {
    const file = this.files.get(key);
    if (!file) throw new StorageUnavailable('missing');
    return file;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

const location = (id: string, active: boolean): LocationState => ({ id, type: 's3_compatible', name: id === 'new' ? 'New bucket' : 'Old bucket', config: { prefix: id }, secretHints: {}, active, lastCheck: null, version: 1 });

class Locations implements Partial<LocationRepository> {
  readonly rows = new Map<string, LocationState>([
    ['old', location('old', false)],
    ['new', location('new', true)],
  ]);
  async find(id: string) {
    return this.rows.get(id) ?? null;
  }
  async active() {
    return [...this.rows.values()].find((row) => row.active) ?? null;
  }
  async sealedSecrets() {
    return null;
  }
}

class Objects implements ObjectRepository {
  readonly rows = new Map<string, StoredObject & { superseded?: boolean }>();
  async add(object: StoredObject) {
    this.rows.set(object.id, object);
  }
  async find(id: string) {
    return this.rows.get(id) ?? null;
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
  async supersede(id: string) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, superseded: true });
  }
  async countOutside(locationId: string) {
    const outside = [...this.rows.values()].filter((row) => row.locationId !== locationId && !row.superseded);
    return { files: outside.length, bytes: outside.reduce((sum, row) => sum + row.sizeBytes, 0) };
  }
}

/** A module's table of files: bytes inline, or a reference to a stored object. */
class Holder implements FileHolder {
  readonly purpose = 'product-media' as const;
  readonly rows = new Map<string, { inline: Uint8Array | null; objectId: string | null; sha256: string; sizeBytes: number }>();
  changeDuringCopy: string | null = null;
  async scan(after: string | null, limit: number): Promise<HeldFile[]> {
    return [...this.rows.entries()]
      .filter(([id]) => after === null || id > after)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, limit)
      .map(([rowId, row]) => ({ rowId, objectId: row.objectId, contentType: 'image/png', sizeBytes: row.sizeBytes, sha256: row.sha256 }));
  }
  async inlineUsage() {
    const inline = [...this.rows.values()].filter((row) => row.inline);
    return { files: inline.length, bytes: inline.reduce((sum, row) => sum + row.sizeBytes, 0) };
  }
  async readInline(rowId: string) {
    return this.rows.get(rowId)?.inline ?? null;
  }
  async repoint(rowId: string, from: string | null, to: string) {
    if (this.changeDuringCopy === rowId) return false;
    const row = this.rows.get(rowId);
    if (!row || row.objectId !== from) return false;
    this.rows.set(rowId, { ...row, inline: null, objectId: to });
    return true;
  }
}

class Moves implements MoveRepository {
  job: MoveJob | null = null;
  stopAfter = Infinity;
  saves = 0;
  async create(job: Pick<MoveJob, 'id' | 'targetLocationId' | 'deleteOld' | 'concurrency' | 'total' | 'createdBy'>) {
    if (this.job && (this.job.status === 'queued' || this.job.status === 'running')) return false;
    this.job = { ...job, status: 'queued', moved: 0, skipped: 0, failed: 0, movedBytes: 0, cursor: { holder: 0, after: null }, problems: [], message: null, createdAt: new Date(), startedAt: null, finishedAt: null };
    return true;
  }
  async find() {
    return this.job;
  }
  async recent() {
    return this.job ? [this.job] : [];
  }
  async claim() {
    if (!this.job || this.job.status !== 'queued') return null;
    this.job = { ...this.job, status: 'running' };
    return this.job;
  }
  readonly saved: MoveProgress[] = [];
  onSave: (progress: MoveProgress) => void = () => undefined;
  async progress(_id: string, progress: MoveProgress) {
    if (!this.job || this.job.status !== 'running') return false;
    if (++this.saves > this.stopAfter) {
      this.job = { ...this.job, status: 'cancelled' };
      return false;
    }
    this.saved.push(progress);
    this.onSave(progress);
    const { problems, ...rest } = progress;
    this.job = { ...this.job, ...rest, problems: [...(problems ?? []), ...this.job.problems] };
    return true;
  }
  async finish(_id: string, status: MoveJob['status'], message: string | null) {
    if (this.job) this.job = { ...this.job, status, message };
  }
  async cancel() {
    return false;
  }
}

function setup() {
  const buckets = { old: new Bucket(), new: new Bucket() };
  const factory: DriverFactory = { create: (_kind, _type, config) => buckets[config.prefix as 'old' | 'new'] };
  const locations = new Locations();
  const objects = new Objects();
  const pool = new DriverPool(factory, { seal: (text) => text, open: (text) => text }, async () => JSON.stringify({ accessKeyId: 'key', secretAccessKey: 'secret' }));
  let n = 0;
  const ids = { uuid: () => `id-${String(++n).padStart(4, '0')}` };
  const clock = { now: () => new Date('2026-11-26T12:00:00Z') };
  const files = new FileStorage(locations as unknown as LocationRepository, objects, pool, ids, clock);
  const holder = new Holder();
  const holders = new FileHolders();
  holders.register(holder);
  const moves = new Moves();
  const errors: string[] = [];
  const service = new StorageMoveService(moves, locations as unknown as LocationRepository, objects, holders, ids, clock);
  const runner = new StorageMoveRunner(moves, locations as unknown as LocationRepository, files, holders, { sha256: sha }, clock, { error: (message) => errors.push(message) });
  return { buckets, locations, objects, files, holder, moves, service, runner, errors };
}

/** Two photos in the database and one in the old bucket. */
async function seed(ctx: ReturnType<typeof setup>) {
  for (const [rowId, text] of [
    ['a', 'photo a'],
    ['b', 'photo b'],
  ] as const) {
    const content = bytes(text);
    ctx.holder.rows.set(rowId, { inline: content, objectId: null, sha256: sha(content), sizeBytes: content.length });
  }
  const old = bytes('photo c');
  const stored = await ctx.files.putIn((await ctx.locations.find('old'))!, { purpose: 'product-media', contentType: 'image/png', extension: 'png', content: old, sha256: sha(old) });
  ctx.holder.rows.set('c', { inline: null, objectId: stored.objectId, sha256: sha(old), sizeBytes: old.length });
  return stored.objectId;
}

describe('moving files into the active location', () => {
  it('moves database and old-location files, verifies each copy, and deletes old copies', async () => {
    const ctx = setup();
    const oldObject = await seed(ctx);
    const summary = await ctx.service.summary();
    expect(summary).toMatchObject({ activeId: 'new', database: { files: 2, bytes: 14 }, otherLocations: { files: 1 } });

    const job = await ctx.service.start(actor, { deleteOld: true, concurrency: 1 });
    expect(job.total).toBe(3);
    expect(await ctx.runner.runOnce()).toBe(true);

    expect(ctx.moves.job).toMatchObject({ status: 'completed', moved: 3, failed: 0, skipped: 0, movedBytes: 21, message: null });
    for (const row of ctx.holder.rows.values()) {
      expect(row.inline).toBeNull();
      expect(ctx.objects.rows.get(row.objectId!)!.locationId).toBe('new');
    }
    expect(ctx.buckets.new.files.size).toBe(3);
    expect(ctx.buckets.old.files.size).toBe(0);
    expect(ctx.objects.rows.has(oldObject)).toBe(false);
    expect(await ctx.service.summary()).toMatchObject({ database: { files: 0 }, otherLocations: { files: 0 } });
  });

  it('keeps old copies when asked, without counting them as still to move', async () => {
    const ctx = setup();
    const oldObject = await seed(ctx);
    await ctx.service.start(actor, { deleteOld: false, concurrency: 1 });
    await ctx.runner.runOnce();
    expect(ctx.buckets.old.files.size).toBe(1);
    expect(ctx.objects.rows.get(oldObject)).toMatchObject({ superseded: true });
    expect((await ctx.service.summary()).otherLocations.files).toBe(0);
  });

  it('skips files already in the target, and those changed while being copied', async () => {
    const ctx = setup();
    await seed(ctx);
    const there = bytes('already new');
    const stored = await ctx.files.putIn((await ctx.locations.find('new'))!, { purpose: 'product-media', contentType: 'image/png', extension: 'png', content: there, sha256: sha(there) });
    ctx.holder.rows.set('d', { inline: null, objectId: stored.objectId, sha256: sha(there), sizeBytes: there.length });
    ctx.holder.changeDuringCopy = 'b';
    await ctx.service.start(actor, { deleteOld: true, concurrency: 1 });
    await ctx.runner.runOnce();
    expect(ctx.moves.job).toMatchObject({ status: 'completed', moved: 2, skipped: 2 });
    // The copy made for the changed row was removed again.
    expect(ctx.buckets.new.files.size).toBe(3);
    expect(ctx.holder.rows.get('b')!.inline).not.toBeNull();
  });

  it('leaves a file where it is if its bytes do not match its checksum, or the copy comes back different', async () => {
    const ctx = setup();
    await seed(ctx);
    ctx.holder.rows.set('a', { ...ctx.holder.rows.get('a')!, sha256: 'not-the-real-hash' });
    ctx.buckets.new.corrupt = true;
    await ctx.service.start(actor, { deleteOld: true, concurrency: 1 });
    await ctx.runner.runOnce();
    expect(ctx.moves.job).toMatchObject({ status: 'completed', moved: 0, failed: 3 });
    expect(ctx.moves.job!.message).toContain('3 files could not be moved');
    expect(ctx.moves.job!.problems.map((problem) => problem.message)).toEqual(
      expect.arrayContaining(['The stored file does not match its checksum, so it was left where it is.', 'The copy in New bucket did not match the original, so the original was kept.']),
    );
    expect(ctx.holder.rows.get('b')!.inline).not.toBeNull();
    expect(ctx.buckets.new.files.size).toBe(0);
  });

  it('gives up after ten failures in a row instead of failing every file', async () => {
    const ctx = setup();
    for (let index = 0; index < 15; index++) {
      const content = bytes(`photo ${index}`);
      ctx.holder.rows.set(`r${String(index).padStart(2, '0')}`, { inline: content, objectId: null, sha256: sha(content), sizeBytes: content.length });
    }
    ctx.buckets.new.failPut = 'The storage service took too long to answer. Try again.';
    await ctx.service.start(actor, { deleteOld: true, concurrency: 1 });
    await ctx.runner.runOnce();
    expect(ctx.moves.job).toMatchObject({ status: 'failed', failed: 10 });
    expect(ctx.moves.job!.message).toContain('took too long');
  });

  it('stops when staff stop it, and when another location becomes active', async () => {
    const stopped = setup();
    await seed(stopped);
    await stopped.service.start(actor, { deleteOld: true, concurrency: 1 });
    stopped.moves.stopAfter = 1;
    await stopped.runner.runOnce();
    expect(stopped.moves.job).toMatchObject({ status: 'cancelled', moved: 1 });

    const switched = setup();
    await seed(switched);
    await switched.service.start(actor, { deleteOld: true, concurrency: 1 });
    switched.locations.rows.set('new', { ...switched.locations.rows.get('new')!, active: false });
    await switched.runner.runOnce();
    expect(switched.moves.job).toMatchObject({ status: 'cancelled', moved: 0 });
    expect(switched.moves.job!.message).toContain('another place was chosen');
  });

  it('refuses to start with nothing to move, no active location, or a move already running', async () => {
    const ctx = setup();
    await expect(ctx.service.start(actor, { deleteOld: true, concurrency: 1 })).rejects.toThrow('Every file is already in New bucket');
    await seed(ctx);
    await ctx.service.start(actor, { deleteOld: true, concurrency: 1 });
    await expect(ctx.service.start(actor, { deleteOld: true, concurrency: 1 })).rejects.toThrow('already being moved');
    ctx.locations.rows.set('new', { ...ctx.locations.rows.get('new')!, active: false });
    await expect(ctx.service.start(actor, { deleteOld: true, concurrency: 1 })).rejects.toThrow('Make a storage location active first');
  });

  describe('several files at once', () => {
    function many(ctx: ReturnType<typeof setup>, count: number) {
      for (let index = 0; index < count; index++) {
        const content = bytes(`photo ${String(index).padStart(3, '0')}`);
        ctx.holder.rows.set(`r${String(index).padStart(3, '0')}`, { inline: content, objectId: null, sha256: sha(content), sizeBytes: content.length });
      }
    }

    it('copies up to the chosen number of files at the same time', async () => {
      const ctx = setup();
      many(ctx, 40);
      ctx.buckets.new.delay = () => 5;
      await ctx.service.start(actor, { deleteOld: true, concurrency: 4 });
      await ctx.runner.runOnce();
      expect(ctx.moves.job).toMatchObject({ status: 'completed', moved: 40, failed: 0, concurrency: 4 });
      // Each upload is followed by a read-back, so uploads overlap up to the limit and never beyond.
      expect(ctx.buckets.new.mostInFlight).toBe(4);
      expect([...ctx.holder.rows.values()].every((row) => row.inline === null)).toBe(true);
    });

    it('never saves a position past a file that is still being copied', async () => {
      const ctx = setup();
      many(ctx, 12);
      // The first file of each group of four is slow, so later files finish first.
      ctx.buckets.new.delay = (content) => (/photo 0(00|04|08)/.test(Buffer.from(content).toString()) ? 30 : 1);
      ctx.moves.onSave = (progress) => {
        if (!progress.cursor.after) return;
        for (const [rowId, row] of ctx.holder.rows) {
          if (rowId <= progress.cursor.after) expect(row.inline).toBeNull();
        }
      };
      await ctx.service.start(actor, { deleteOld: true, concurrency: 4 });
      await ctx.runner.runOnce();
      expect(ctx.moves.job).toMatchObject({ status: 'completed', moved: 12 });
      const positions = ctx.moves.saved.map((progress) => progress.cursor.after).filter(Boolean) as string[];
      expect(positions).toEqual([...positions].sort());
      expect(positions.at(-1)).toBe('r011');
    });

    it('counts failures in file order when files run in parallel', async () => {
      const ctx = setup();
      many(ctx, 30);
      ctx.buckets.new.failPut = 'The storage service took too long to answer. Try again.';
      await ctx.service.start(actor, { deleteOld: true, concurrency: 5 });
      await ctx.runner.runOnce();
      expect(ctx.moves.job).toMatchObject({ status: 'failed', failed: 10 });
      expect(ctx.moves.job!.problems).toHaveLength(10);
      // No file was left without its bytes.
      expect([...ctx.holder.rows.values()].every((row) => row.inline !== null)).toBe(true);
    });

    it('starts no new files once staff stop it', async () => {
      const ctx = setup();
      many(ctx, 30);
      ctx.buckets.new.delay = () => 2;
      ctx.moves.stopAfter = 2;
      await ctx.service.start(actor, { deleteOld: true, concurrency: 3 });
      await ctx.runner.runOnce();
      expect(ctx.moves.job!.status).toBe('cancelled');
      const moved = [...ctx.holder.rows.values()].filter((row) => row.inline === null).length;
      // Only the files already started finish (each is whole, in the new location).
      expect(moved).toBeLessThanOrEqual(2 + 3);
      expect(ctx.buckets.new.files.size).toBe(moved);
    });

    it('refuses a number of files at a time outside 1 to 10', async () => {
      const ctx = setup();
      many(ctx, 1);
      await expect(ctx.service.start(actor, { deleteOld: true, concurrency: 0 })).rejects.toThrow('from 1 to 10');
      await expect(ctx.service.start(actor, { deleteOld: true, concurrency: 11 })).rejects.toThrow('from 1 to 10');
    });
  });
});

