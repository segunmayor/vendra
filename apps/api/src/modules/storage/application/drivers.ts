import { publicUrl, servesPublicly, storageType } from '../domain/location';
import { DriverFactory, LocationState, PublicFetcher, SecretSealer, StorageDriver, StorageUnavailable } from './ports';

/**
 * Decrypts a location's credentials and keeps one driver per location version, so connections
 * (and a MEGA sign-in) are reused. A changed location gets a new driver.
 */
export class DriverPool {
  private readonly drivers = new Map<string, { version: number; driver: StorageDriver }>();

  constructor(
    private readonly factory: DriverFactory,
    private readonly sealer: SecretSealer,
    private readonly sealedSecrets: (id: string) => Promise<string | null>,
  ) {}

  async driverFor(location: LocationState): Promise<StorageDriver> {
    const cached = this.drivers.get(location.id);
    if (cached && cached.version === location.version) return cached.driver;
    const sealed = await this.sealedSecrets(location.id);
    const secrets = sealed ? (JSON.parse(this.sealer.open(sealed)) as Record<string, string>) : {};
    const driver = this.build(location, secrets);
    if (cached) void cached.driver.close?.().catch(() => undefined);
    this.drivers.set(location.id, { version: location.version, driver });
    return driver;
  }

  /** A driver for settings not saved yet, to test them first. Not cached. */
  build(location: Pick<LocationState, 'type' | 'config'>, secrets: Readonly<Record<string, string>>): StorageDriver {
    const kind = storageType(location.type);
    if (!kind) throw new StorageUnavailable(`Unknown storage type: ${location.type}`);
    const missing = kind.credentials.filter((field) => field.required && !secrets[field.key]);
    if (missing.length > 0) throw new StorageUnavailable(`Enter ${missing.map((field) => field.label.toLowerCase()).join(' and ')} first`);
    return this.factory.create(kind.driver, location.type, location.config, secrets);
  }

  forget(id: string): void {
    const cached = this.drivers.get(id);
    if (cached) void cached.driver.close?.().catch(() => undefined);
    this.drivers.delete(id);
  }
}

const PROBE = new TextEncoder().encode('Vendra storage check. Safe to delete.');

/** Writes, reads back and deletes a small file, so a location is known to work before files go there. */
export async function probe(driver: StorageDriver, key: string): Promise<void> {
  await driver.put(key, PROBE, 'text/plain');
  const back = await driver.get(key);
  if (back.length !== PROBE.length || !back.every((byte, index) => byte === PROBE[index])) {
    throw new StorageUnavailable('A test file was written but came back different. Check the bucket or folder settings.');
  }
  await driver.delete(key);
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

/**
 * For a location serving photos publicly: a test photo must open at the public address, and a
 * test seller document must not. Stops a whole bucket being made public by mistake.
 */
export async function probePublic(driver: StorageDriver, fetcher: PublicFetcher, location: Pick<LocationState, 'config'>, id: string): Promise<void> {
  if (!servesPublicly(location)) return;
  const base = location.config.publicBaseUrl!;
  const folder = location.config.prefix ?? '';
  const photoKey = [folder, 'product-media', '.vendra-checks', `check-${id}.txt`].filter(Boolean).join('/');
  const documentKey = [folder, 'seller-documents', '.vendra-checks', `check-${id}.txt`].filter(Boolean).join('/');
  const content = new TextEncoder().encode(`Vendra public address check ${id}. Safe to delete.`);
  await driver.put(photoKey, content, 'text/plain');
  await driver.put(documentKey, content, 'text/plain');
  try {
    const photo = await fetcher.get(publicUrl(base, photoKey)).catch(() => null);
    if (!photo) throw new StorageUnavailable(`The public address ${base} could not be reached. Check it, and that its CDN is set up.`);
    if (photo.status !== 200 || !same(photo.body, content)) {
      throw new StorageUnavailable(
        `A test photo did not open at the public address (it answered ${photo.status}). Check that ${base}/<file key> serves this ${location.config.bucket ? 'bucket' : 'container'}, and that ${folder ? `${folder}/` : ''}product-media/ is public.`,
      );
    }
    const document = await fetcher.get(publicUrl(base, documentKey)).catch(() => null);
    if (document && document.status === 200 && same(document.body, content)) {
      throw new StorageUnavailable(
        `Seller documents can be opened by anyone at the public address. Limit public access to ${folder ? `${folder}/` : ''}product-media/ only, then test again.`,
      );
    }
  } finally {
    await driver.delete(photoKey).catch(() => undefined);
    await driver.delete(documentKey).catch(() => undefined);
  }
}
