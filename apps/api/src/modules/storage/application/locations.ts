import { ApplicationError, AuditEntry, DomainError, Principal } from '../../../shared-kernel';
import { checkLocation, hint, LocationState, servesPublicly, STORAGE_TYPES, storageType } from '../domain/location';
import { DriverPool, probe, probePublic } from './drivers';
import { LocationRepository, LocationUsage, PublicFetcher, SecretSealer, StorageDriver, StorageUnavailable } from './ports';

export interface LocationInput {
  readonly name: string;
  readonly config: Readonly<Record<string, string>>;
  /** Blank or missing fields keep the saved value. */
  readonly credentials: Readonly<Record<string, string>>;
}

export interface LocationView extends LocationState {
  readonly usage: LocationUsage;
}

export interface StorageOverview {
  /** Null while files are kept in the database. */
  readonly activeId: string | null;
  readonly locations: readonly LocationView[];
}

/** The audit target for "keep files in the database", which has no row of its own. */
export const DATABASE_TARGET = '00000000-0000-0000-0000-000000000000';

const notFound = () => new ApplicationError('not_found', 'storage.not_found', 'Storage location not found');
const failed = (reason: string) => new DomainError('storage.check_failed', reason);

/**
 * Staff choose where uploaded files are kept. Credentials are encrypted and never returned.
 * A location must pass a live check (write, read back, delete) before it becomes active, and
 * an active location's new settings are checked before they are saved.
 */
export class StorageLocationService {
  constructor(
    private readonly locations: LocationRepository,
    private readonly sealer: SecretSealer,
    private readonly pool: DriverPool,
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
    /** Tells the file store that the active location (or a public address) may have changed. */
    private readonly changed: () => void,
    private readonly fetcher: PublicFetcher,
  ) {}

  types() {
    return STORAGE_TYPES;
  }

  async overview(): Promise<StorageOverview> {
    const [locations, usage] = await Promise.all([this.locations.list(), this.locations.usage()]);
    return {
      activeId: locations.find((location) => location.active)?.id ?? null,
      locations: locations.map((location) => ({ ...location, usage: usage.get(location.id) ?? { files: 0, bytes: 0 } })),
    };
  }

  async get(id: string): Promise<LocationView> {
    const location = await this.locations.find(id);
    if (!location) throw notFound();
    const usage = await this.locations.usage();
    return { ...location, usage: usage.get(id) ?? { files: 0, bytes: 0 } };
  }

  async create(actor: Principal, type: string, input: LocationInput): Promise<LocationState> {
    if (!storageType(type)) throw new ApplicationError('not_found', 'storage.unknown_type', `Unknown storage type: ${type}`);
    const draft: LocationState = { id: this.ids.uuid(), type, name: input.name, config: input.config, secretHints: {}, active: false, lastCheck: null, version: 0 };
    const created = await this.persist(actor, draft, input.credentials, {}, true);
    this.changed();
    return created;
  }

  async update(actor: Principal, id: string, input: LocationInput): Promise<LocationState> {
    const current = await this.find(id);
    const saved = await this.secretsOf(id);
    const updated = await this.persist(actor, { ...current, name: input.name, config: input.config }, input.credentials, saved, false);
    // Photos may be served from a different address now.
    this.pool.forget(id);
    this.changed();
    return updated;
  }

  /** Writes, reads back and deletes a small file with the saved settings. Records the outcome. */
  async test(id: string): Promise<LocationState> {
    const location = await this.find(id);
    const check = await this.check(() => this.pool.driverFor(location), location.config);
    await this.locations.recordCheck(id, check);
    // A failed check stops photos being served from its public address until one passes.
    this.changed();
    return { ...location, lastCheck: check };
  }

  /** New files go to this location from now on. Files already stored stay where they are. */
  async activate(actor: Principal, id: string): Promise<LocationState> {
    const location = await this.find(id);
    const check = await this.check(() => this.pool.driverFor(location), location.config);
    await this.locations.recordCheck(id, check);
    if (!check.ok) throw failed(`${location.name} did not pass its check, so it was not made active: ${check.message}`);
    await this.locations.activate(id, this.audit(actor, 'storage.location_activated', id, { name: location.name, type: location.type }));
    this.changed();
    return { ...location, active: true, lastCheck: check };
  }

  /** New files are kept in the database again. */
  async useDatabase(actor: Principal): Promise<void> {
    await this.locations.activate(null, this.audit(actor, 'storage.database_activated', DATABASE_TARGET, {}));
    this.changed();
  }

  async remove(actor: Principal, id: string): Promise<void> {
    const location = await this.find(id);
    if (location.active) throw new DomainError('storage.in_use', 'This is where new files go. Make another location active first.');
    const removed = await this.locations.remove(id, this.audit(actor, 'storage.location_removed', id, { name: location.name, type: location.type }));
    if (!removed) throw new DomainError('storage.has_files', 'Files are kept here, so it cannot be removed. Removing it would break them.');
    this.pool.forget(id);
  }

  private async find(id: string): Promise<LocationState> {
    const location = await this.locations.find(id);
    if (!location) throw notFound();
    return location;
  }

  private async check(driver: () => Promise<StorageDriver> | StorageDriver, config: Readonly<Record<string, string>>) {
    const at = this.clock.now();
    try {
      // Inside the location's folder, so a key limited to that folder passes too.
      const built = await driver();
      await probe(built, [config.prefix, '.vendra-checks', `check-${this.ids.uuid()}.txt`].filter(Boolean).join('/'));
      await probePublic(built, this.fetcher, { config }, this.ids.uuid());
      return { at, ok: true, message: null };
    } catch (error) {
      return { at, ok: false, message: reason(error) };
    }
  }

  private async secretsOf(id: string): Promise<Record<string, string>> {
    const sealed = await this.locations.sealedSecrets(id);
    return sealed ? (JSON.parse(this.sealer.open(sealed)) as Record<string, string>) : {};
  }

  private async persist(
    actor: Principal,
    draft: LocationState,
    incoming: Readonly<Record<string, string>>,
    saved: Readonly<Record<string, string>>,
    isNew: boolean,
  ): Promise<LocationState> {
    const { name, config, secrets } = checkLocation(draft, incoming, saved);
    const changedSecrets = Object.keys(secrets).filter((key) => secrets[key] !== saved[key]);
    // Files are going to the active location, or shoppers will load photos from the public
    // address, right after saving: refuse settings that do not work.
    let check: Awaited<ReturnType<StorageLocationService['check']>> | null = null;
    if (draft.active || servesPublicly({ config })) {
      check = await this.check(() => this.pool.build({ type: draft.type, config }, secrets), config);
      if (!check.ok) throw failed(`The new settings did not pass the check, so nothing was changed: ${check.message}`);
    }
    const state: LocationState = {
      ...draft,
      name,
      config,
      secretHints: Object.fromEntries(Object.entries(secrets).map(([key, value]) => [key, hint(value)])),
    };
    await this.locations.save(
      state,
      this.sealer.seal(JSON.stringify(secrets)),
      isNew,
      // Which credentials changed is recorded; their values never are.
      this.audit(actor, isNew ? 'storage.location_created' : 'storage.location_updated', state.id, {
        type: state.type,
        name,
        config,
        credentialsChanged: changedSecrets,
      }),
    );
    if (check) await this.locations.recordCheck(state.id, check);
    return { ...state, lastCheck: check ?? state.lastCheck, version: state.version + 1 };
  }

  private audit(actor: Principal, action: string, targetId: string, after: Record<string, unknown>): AuditEntry {
    return { actorId: actor.accountId, action, targetType: 'storage_location', targetId, after };
  }
}

/** A readable reason from a driver or SDK error, never a stack trace or credential. */
export function reason(error: unknown): string {
  if (error instanceof StorageUnavailable || error instanceof DomainError || error instanceof ApplicationError) return error.message;
  return 'The storage service could not be reached. Check the settings and try again.';
}
