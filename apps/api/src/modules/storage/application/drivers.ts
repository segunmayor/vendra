import { storageType } from '../domain/location';
import { DriverFactory, LocationState, SecretSealer, StorageDriver, StorageUnavailable } from './ports';

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
