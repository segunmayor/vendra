import { Principal } from '../../../shared-kernel';
import { LocationState } from '../domain/location';
import { DriverPool } from './drivers';
import { FileStorage } from './file-storage';
import { StorageLocationService } from './locations';
import { DriverFactory, LocationCheck, LocationRepository, LocationUsage, ObjectRepository, StorageDriver, StoredObject, StorageUnavailable } from './ports';

const actor: Principal = { accountId: '11111111-1111-4111-8111-111111111111', sessionId: 's', audience: 'admin', permissions: ['settings.manage'] };

class MemoryDriver implements StorageDriver {
  readonly files = new Map<string, Uint8Array>();
  failWith: string | null = null;
  async put(key: string, content: Uint8Array) {
    if (this.failWith) throw new StorageUnavailable(this.failWith);
    this.files.set(key, content);
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

class MemoryLocations implements LocationRepository {
  readonly rows = new Map<string, { state: LocationState; sealed: string | null }>();
  readonly audits: string[] = [];
  readonly files = new Map<string, number>();
  async list() {
    return [...this.rows.values()].map((row) => row.state);
  }
  async find(id: string) {
    return this.rows.get(id)?.state ?? null;
  }
  async active() {
    return [...this.rows.values()].find((row) => row.state.active)?.state ?? null;
  }
  async sealedSecrets(id: string) {
    return this.rows.get(id)?.sealed ?? null;
  }
  async usage() {
    return new Map<string, LocationUsage>([...this.files].map(([id, files]) => [id, { files, bytes: files * 10 }]));
  }
  async save(state: LocationState, sealed: string | null, _isNew: boolean, audit: { action: string }) {
    this.rows.set(state.id, { state: { ...state, version: state.version + 1 }, sealed });
    this.audits.push(audit.action);
  }
  async recordCheck(id: string, check: LocationCheck) {
    const row = this.rows.get(id)!;
    row.state = { ...row.state, lastCheck: check };
  }
  async activate(id: string | null, audit: { action: string }) {
    for (const row of this.rows.values()) row.state = { ...row.state, active: row.state.id === id };
    this.audits.push(audit.action);
  }
  async remove(id: string, audit: { action: string }) {
    if ((this.files.get(id) ?? 0) > 0 || this.rows.get(id)?.state.active) return false;
    this.rows.delete(id);
    this.audits.push(audit.action);
    return true;
  }
}

class MemoryObjects implements ObjectRepository {
  readonly rows = new Map<string, StoredObject & { purpose: string }>();
  async add(object: StoredObject & { purpose: string }) {
    this.rows.set(object.id, object);
  }
  async findMany(ids: readonly string[]) {
    return ids.flatMap((id) => (this.rows.has(id) ? [this.rows.get(id)!] : []));
  }
  async find(id: string) {
    return this.rows.get(id) ?? null;
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
  async supersede() {}
  async countOutside(locationId: string) {
    const outside = [...this.rows.values()].filter((row) => row.locationId !== locationId);
    return { files: outside.length, bytes: outside.reduce((sum, row) => sum + row.sizeBytes, 0) };
  }
}

function setup() {
  const driver = new MemoryDriver();
  const built: Record<string, string>[] = [];
  const factory: DriverFactory = {
    create: (_kind, _type, _config, secrets) => {
      built.push({ ...secrets });
      return driver;
    },
  };
  const locations = new MemoryLocations();
  const objects = new MemoryObjects();
  // A reversible stand-in for encryption, enough to prove secrets are sealed and opened.
  const sealer = { seal: (text: string) => `sealed:${Buffer.from(text).toString('base64')}`, open: (text: string) => Buffer.from(text.slice(7), 'base64').toString() };
  const pool = new DriverPool(factory, sealer, (id) => locations.sealedSecrets(id));
  let n = 0;
  const ids = { uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
  const clock = { now: () => new Date('2026-11-26T12:00:00Z') };
  const files = new FileStorage(locations, objects, pool, ids, clock);
  /** A CDN in front of the memory bucket: what it serves depends on what the test makes public. */
  const cdn = { base: 'https://cdn.example.test', publicPrefixes: ['vendra/product-media/'], reachable: true };
  const fetcher = {
    get: async (url: string) => {
      if (!cdn.reachable) throw new Error('ENOTFOUND');
      const key = decodeURIComponent(url.slice(cdn.base.length + 1));
      const file = driver.files.get(key);
      return file && cdn.publicPrefixes.some((prefix) => key.startsWith(prefix)) ? { status: 200, body: file } : { status: 403, body: new Uint8Array() };
    },
  };
  const service = new StorageLocationService(locations, sealer, pool, ids, clock, () => files.invalidate(), fetcher);
  return { driver, built, locations, objects, files, service, cdn };
}

const input = { name: 'Photos on R2', config: { endpoint: 'https://abc.r2.cloudflarestorage.com', bucket: 'vendra-files' }, credentials: { accessKeyId: 'AKIA1234', secretAccessKey: 'very-secret-key-9876' } };
const photo = { purpose: 'product-media' as const, contentType: 'image/png', extension: 'png', content: new Uint8Array([1, 2, 3]), sha256: 'abc' };

const photo_ = { purpose: 'product-media' as const, contentType: 'image/png', extension: 'png', content: new Uint8Array([1, 2, 3]), sha256: 'abc' };

describe('storage locations', () => {
  it('seals credentials and keeps only hints', async () => {
    const { service, locations } = setup();
    const created = await service.create(actor, 's3_compatible', input);
    expect(created.secretHints).toEqual({ accessKeyId: '••••', secretAccessKey: '••••9876' });
    expect(JSON.stringify(created)).not.toContain('very-secret-key');
    expect(locations.rows.get(created.id)!.sealed).toMatch(/^sealed:/);
    expect(locations.audits).toEqual(['storage.location_created']);
  });

  it('activates only after a passing check, and then new files go there', async () => {
    const { service, driver, files, objects } = setup();
    const created = await service.create(actor, 's3_compatible', input);
    expect(await files.put(photo)).toBeNull();

    driver.failWith = 'The bucket does not exist.';
    await expect(service.activate(actor, created.id)).rejects.toThrow('did not pass its check');
    expect((await service.get(created.id)).lastCheck).toMatchObject({ ok: false, message: 'The bucket does not exist.' });

    driver.failWith = null;
    await service.activate(actor, created.id);
    // The check file is cleaned up.
    expect([...driver.files.keys()]).toEqual([]);
    const stored = await files.put(photo);
    expect(stored).not.toBeNull();
    const object = objects.rows.get(stored!.objectId)!;
    expect(object.key).toBe(`vendra/product-media/2026/11/${stored!.objectId}.png`);
    expect(await files.get(stored!.objectId)).toEqual(photo.content);
  });

  it('never falls back to the database when the active location fails', async () => {
    const { service, driver, files } = setup();
    const created = await service.create(actor, 's3_compatible', input);
    await service.activate(actor, created.id);
    driver.failWith = 'The storage service took too long to answer.';
    await expect(files.put(photo)).rejects.toThrow('could not be saved to Photos on R2. The storage service took too long');
  });

  it('refuses new settings for the active location that do not work, and keeps the old ones', async () => {
    const { service, driver, locations } = setup();
    const created = await service.create(actor, 's3_compatible', input);
    await service.activate(actor, created.id);
    driver.failWith = 'The secret access key does not match the access key ID.';
    await expect(service.update(actor, created.id, { ...input, credentials: { secretAccessKey: 'wrong-key-0000' } })).rejects.toThrow('nothing was changed');
    expect(locations.rows.get(created.id)!.state.secretHints.secretAccessKey).toBe('••••9876');
  });

  it('keeps saved credentials when the form leaves them blank', async () => {
    const { service, built } = setup();
    const created = await service.create(actor, 's3_compatible', input);
    await service.update(actor, created.id, { ...input, name: 'Renamed', credentials: { accessKeyId: '', secretAccessKey: '' } });
    await service.test(created.id);
    expect(built.at(-1)).toEqual(input.credentials);
  });

  it('switches back to the database, and protects locations that hold files', async () => {
    const { service, locations, files } = setup();
    const created = await service.create(actor, 's3_compatible', input);
    await service.activate(actor, created.id);
    await expect(service.remove(actor, created.id)).rejects.toThrow('Make another location active first');
    await service.useDatabase(actor);
    expect(await files.put(photo)).toBeNull();
    locations.files.set(created.id, 2);
    await expect(service.remove(actor, created.id)).rejects.toThrow('Files are kept here');
    locations.files.delete(created.id);
    await service.remove(actor, created.id);
    expect(locations.audits).toContain('storage.location_removed');
  });

  describe('public address (CDN)', () => {
    const withCdn = { ...input, config: { ...input.config, publicDelivery: 'true', publicBaseUrl: 'https://cdn.example.test' } };

    it('checks that photos open there before saving, then hands out public addresses for photos only', async () => {
      const { service, files, driver } = setup();
      const created = await service.create(actor, 's3_compatible', withCdn);
      expect(created.lastCheck).toMatchObject({ ok: true });
      // Both test files are cleaned up.
      expect(driver.files.size).toBe(0);
      await service.activate(actor, created.id);
      const photo = await files.put(photo_);
      const document = await files.put({ ...photo_, purpose: 'seller-documents', contentType: 'application/pdf', extension: 'pdf' });
      const urls = await files.publicUrls([photo!.objectId, document!.objectId]);
      expect(urls.get(photo!.objectId)).toBe(`https://cdn.example.test/vendra/product-media/2026/11/${photo!.objectId}.png`);
      expect(urls.has(document!.objectId)).toBe(false);
    });

    it('refuses an address where seller documents can be opened', async () => {
      const { service, cdn } = setup();
      cdn.publicPrefixes = ['vendra/'];
      await expect(service.create(actor, 's3_compatible', withCdn)).rejects.toThrow('Seller documents can be opened by anyone');
    });

    it('refuses an address that does not serve the bucket, or cannot be reached', async () => {
      const first = setup();
      first.cdn.publicPrefixes = [];
      await expect(first.service.create(actor, 's3_compatible', withCdn)).rejects.toThrow('did not open at the public address (it answered 403)');
      const second = setup();
      second.cdn.reachable = false;
      await expect(second.service.create(actor, 's3_compatible', withCdn)).rejects.toThrow('could not be reached');
    });

    it('stops handing out public addresses after a failed check, until one passes', async () => {
      const { service, files, cdn } = setup();
      const created = await service.create(actor, 's3_compatible', withCdn);
      await service.activate(actor, created.id);
      const photo = await files.put(photo_);
      cdn.reachable = false;
      await service.test(created.id);
      expect((await files.publicUrls([photo!.objectId])).size).toBe(0);
      cdn.reachable = true;
      await service.test(created.id);
      expect((await files.publicUrls([photo!.objectId])).size).toBe(1);
    });

    it('needs the address when serving publicly is turned on', async () => {
      const { service } = setup();
      await expect(service.create(actor, 's3_compatible', { ...input, config: { ...input.config, publicDelivery: 'true' } })).rejects.toThrow('Enter the public address');
    });
  });
});

