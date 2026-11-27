import { ApplicationError } from '../../../shared-kernel';
import { FilePurpose, LocationState, objectKey, publicUrl, servesPublicly } from '../domain/location';
import { DriverPool } from './drivers';
import { reason } from './locations';
import { LocationRepository, ObjectRepository } from './ports';

/** How long the active location is remembered before it is looked up again (other API processes may change it). */
const ACTIVE_TTL_MS = 5_000;

export interface FileToStore {
  readonly purpose: FilePurpose;
  readonly contentType: string;
  readonly extension: string;
  readonly content: Uint8Array;
  readonly sha256: string;
}

/**
 * Where modules keep uploaded files. With no active location, files stay in each module's own
 * table (put returns null); otherwise they go to the active storage service and a reference is
 * kept. A file is always read from where it was written, so changing the active location never
 * breaks files already stored.
 */
export class FileStorage {
  private cachedActive: { at: number; location: LocationState | null } | null = null;

  constructor(
    private readonly locations: LocationRepository,
    private readonly objects: ObjectRepository,
    private readonly pool: DriverPool,
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
  ) {}

  /** Stores a file in the active location. Null means the caller keeps the bytes in its own table. */
  async put(file: FileToStore): Promise<{ objectId: string } | null> {
    const location = await this.active();
    if (!location) return null;
    return this.putIn(location, file);
  }

  /** Stores a file in a given location, active or not. */
  async putIn(location: LocationState, file: FileToStore): Promise<{ objectId: string }> {
    const id = this.ids.uuid();
    const key = objectKey(location.config.prefix ?? '', file.purpose, id, file.extension, this.clock.now());
    try {
      const driver = await this.pool.driverFor(location);
      await driver.put(key, file.content, file.contentType);
    } catch (error) {
      // Never falls back to the database: staff chose to keep files off this server.
      throw new ApplicationError('unavailable', 'storage.write_failed', `The file could not be saved to ${location.name}. ${reason(error)}`);
    }
    await this.objects.add({ id, locationId: location.id, key, contentType: file.contentType, sizeBytes: file.content.length, sha256: file.sha256, purpose: file.purpose });
    return { objectId: id };
  }

  /** Bytes start to end (both included) of a stored file, without reading all of it where the service allows. */
  async getRange(objectId: string, start: number, end: number): Promise<Uint8Array | null> {
    const object = await this.objects.find(objectId);
    if (!object) return null;
    const location = await this.locations.find(object.locationId);
    if (!location) return null;
    try {
      const driver = await this.pool.driverFor(location);
      if (driver.getRange) return await driver.getRange(object.key, start, end);
      return (await driver.get(object.key)).subarray(start, end + 1);
    } catch (error) {
      throw new ApplicationError('unavailable', 'storage.read_failed', `The file could not be read from ${location.name}. ${reason(error)}`);
    }
  }

  /** Which location holds a stored file. */
  async locationOf(objectId: string): Promise<string | null> {
    return (await this.objects.find(objectId))?.locationId ?? null;
  }

  /** Keeps a stored file where it is, but records that nothing uses it any more. */
  async supersede(objectId: string): Promise<void> {
    await this.objects.supersede(objectId, this.clock.now());
  }

  /** Deletes a stored file from its location, then forgets it. Already missing there counts as deleted. */
  async remove(objectId: string): Promise<void> {
    const object = await this.objects.find(objectId);
    if (!object) return;
    const location = await this.locations.find(object.locationId);
    if (location) {
      try {
        await (await this.pool.driverFor(location)).delete(object.key);
      } catch (error) {
        throw new ApplicationError('unavailable', 'storage.delete_failed', `The old copy could not be deleted from ${location.name}. ${reason(error)}`);
      }
    }
    await this.objects.remove(objectId);
  }

  /** The bytes of a stored file. Null if the reference is unknown. */
  async get(objectId: string): Promise<Uint8Array | null> {
    const object = await this.objects.find(objectId);
    if (!object) return null;
    const location = await this.locations.find(object.locationId);
    if (!location) return null;
    try {
      return await (await this.pool.driverFor(location)).get(object.key);
    } catch (error) {
      throw new ApplicationError('unavailable', 'storage.read_failed', `The file could not be read from ${location.name}. ${reason(error)}`);
    }
  }

  /**
   * Public addresses for product photos kept in a location that serves them publicly and passed
   * its last check. Others are left out: they are served through Vendra.
   */
  async publicUrls(objectIds: readonly string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (objectIds.length === 0) return result;
    const locations = await this.publicLocations();
    if (locations.size === 0) return result;
    for (const object of await this.objects.findMany(objectIds)) {
      const location = locations.get(object.locationId);
      if (location && object.purpose === 'product-media') result.set(object.id, publicUrl(location.config.publicBaseUrl!, object.key));
    }
    return result;
  }

  /** Forgets the remembered active location and public addresses, after staff change them. */
  invalidate(): void {
    this.cachedActive = null;
    this.cachedPublic = null;
    this.changes++;
  }

  private changes = 0;

  /** Goes up whenever staff change storage settings here, so callers can drop cached addresses. */
  generation(): number {
    return this.changes;
  }

  private cachedPublic: { at: number; locations: Map<string, LocationState> } | null = null;

  private async publicLocations(): Promise<Map<string, LocationState>> {
    const now = Date.now();
    if (this.cachedPublic && now - this.cachedPublic.at < ACTIVE_TTL_MS) return this.cachedPublic.locations;
    // A failed check turns public delivery off until a check passes again: photos then go through Vendra.
    const locations = new Map((await this.locations.list()).filter((location) => servesPublicly(location) && location.lastCheck?.ok).map((location) => [location.id, location]));
    this.cachedPublic = { at: now, locations };
    return locations;
  }

  private async active(): Promise<LocationState | null> {
    const now = Date.now();
    if (this.cachedActive && now - this.cachedActive.at < ACTIVE_TTL_MS) return this.cachedActive.location;
    const location = await this.locations.active();
    this.cachedActive = { at: now, location };
    return location;
  }
}
