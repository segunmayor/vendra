import { AuditEntry, Principal } from '../../../shared-kernel';
import { GROUPS, isSettingKey, parseValue, SettingDefinition, SettingGroup, SettingKey, SETTINGS, SettingValue } from '../domain/definitions';

export { GROUPS, SETTINGS } from '../domain/definitions';
export type { SettingDefinition, SettingGroup, SettingKey, SettingValue } from '../domain/definitions';

export interface SettingsStore {
  all(): Promise<Map<string, unknown>>;
  /** Saves all changes and their audit entry in one transaction. */
  save(changes: ReadonlyMap<SettingKey, unknown>, actorId: string, audit: AuditEntry): Promise<void>;
}

/** How long a process trusts its copy. A change is seen by other API instances within this time. */
const CACHE_MS = 10_000;

/**
 * Read side for every module. Stored values that no longer pass validation (for example
 * after a range was tightened) fall back to the default rather than breaking the shop.
 */
export class SettingsReader {
  private cached: { at: number; values: Map<string, unknown> } | null = null;

  constructor(
    private readonly store: SettingsStore,
    private readonly clock: { now(): Date },
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const stored = (await this.load()).get(key);
    if (stored === undefined) return SETTINGS[key].default as SettingValue<K>;
    try {
      return parseValue(key, stored) as SettingValue<K>;
    } catch {
      return SETTINGS[key].default as SettingValue<K>;
    }
  }

  async getMany<const K extends readonly SettingKey[]>(keys: K): Promise<{ [I in keyof K]: SettingValue<K[I]> }> {
    return Promise.all(keys.map((key) => this.get(key))) as Promise<{ [I in keyof K]: SettingValue<K[I]> }>;
  }

  invalidate(): void {
    this.cached = null;
  }

  private async load(): Promise<Map<string, unknown>> {
    const now = this.clock.now().getTime();
    if (this.cached && now - this.cached.at < CACHE_MS) return this.cached.values;
    const values = await this.store.all();
    this.cached = { at: now, values };
    return values;
  }
}

export interface SettingView {
  readonly key: SettingKey;
  readonly definition: SettingDefinition;
  readonly value: string | number | boolean;
  readonly isDefault: boolean;
}

export class SettingsService {
  constructor(
    private readonly store: SettingsStore,
    private readonly reader: SettingsReader,
  ) {}

  async list(): Promise<{ group: SettingGroup; label: string; description: string; settings: SettingView[] }[]> {
    const stored = await this.store.all();
    const views = await Promise.all(
      (Object.keys(SETTINGS) as SettingKey[]).map(async (key): Promise<SettingView> => ({
        key,
        definition: SETTINGS[key],
        value: await this.reader.get(key),
        isDefault: !stored.has(key),
      })),
    );
    return (Object.keys(GROUPS) as SettingGroup[]).map((group) => ({
      group,
      ...GROUPS[group],
      settings: views.filter((view) => view.definition.group === group),
    }));
  }

  /** Validates every change first, so a bad value saves nothing. */
  async update(actor: Principal, raw: Readonly<Record<string, unknown>>): Promise<void> {
    const changes = new Map<SettingKey, unknown>();
    const before: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!isSettingKey(key)) throw new UnknownSetting(key);
      changes.set(key, parseValue(key, value));
      before[key] = await this.reader.get(key);
    }
    if (changes.size === 0) return;
    await this.store.save(changes, actor.accountId, {
      actorId: actor.accountId,
      action: 'settings.updated',
      targetType: 'settings',
      targetId: [...changes.keys()].join(','),
      before,
      after: Object.fromEntries(changes),
    });
    this.reader.invalidate();
  }

  /** Settings marked public, for the storefront. */
  async publicValues(): Promise<Record<string, string | number | boolean>> {
    const keys = (Object.keys(SETTINGS) as SettingKey[]).filter((key) => 'public' in SETTINGS[key] && SETTINGS[key].public);
    return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await this.reader.get(key)] as const)));
  }
}

export class UnknownSetting extends Error {
  constructor(readonly key: string) {
    super(`Unknown setting: ${key}`);
  }
}
