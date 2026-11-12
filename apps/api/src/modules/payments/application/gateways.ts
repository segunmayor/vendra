import { ApplicationError, AuditEntry, Principal } from '../../../shared-kernel';
import { checkGateway, GATEWAY_TYPES, GatewayMode, GatewayState, gatewayType, hint } from '../domain/gateway';
import { PaymentProviderPort, ProviderUnavailable } from './ports';

export { GATEWAY_TYPES } from '../domain/gateway';
export type { GatewayMode, GatewayState, GatewayType } from '../domain/gateway';

export interface GatewayRepository {
  list(): Promise<GatewayState[]>;
  find(id: string): Promise<GatewayState | null>;
  /** The sealed credentials, or null if none were saved. */
  sealedSecrets(id: string): Promise<string | null>;
  /** Throws ConcurrencyConflict if the gateway changed since it was read. */
  save(state: GatewayState, sealedSecrets: string | null, isNew: boolean, audit: AuditEntry): Promise<void>;
}

/** Encrypts credentials at rest. */
export interface SecretSealer {
  seal(plaintext: string): string;
  open(sealed: string): string;
}

export interface ProviderFactory {
  create(type: string, config: Readonly<Record<string, string>>, secrets: Readonly<Record<string, string>>): PaymentProviderPort;
}

export interface GatewayInput {
  readonly name: string;
  readonly enabled: boolean;
  readonly mode: GatewayMode;
  readonly position: number;
  readonly config: Readonly<Record<string, string>>;
  /** Blank or missing fields keep the saved value. */
  readonly credentials: Readonly<Record<string, string>>;
}

const notFound = () => new ApplicationError('not_found', 'gateway.not_found', 'Payment gateway not found');

/** Staff configure payment gateways here. Credentials are encrypted, and never returned. */
export class GatewayService {
  constructor(
    private readonly gateways: GatewayRepository,
    private readonly sealer: SecretSealer,
    private readonly providers: ProviderFactory,
    private readonly ids: { uuid(): string },
  ) {}

  types() {
    return GATEWAY_TYPES;
  }

  list(): Promise<GatewayState[]> {
    return this.gateways.list();
  }

  async get(id: string): Promise<GatewayState> {
    const gateway = await this.gateways.find(id);
    if (!gateway) throw notFound();
    return gateway;
  }

  async create(actor: Principal, type: string, input: GatewayInput): Promise<GatewayState> {
    if (!gatewayType(type)) throw new ApplicationError('not_found', 'gateway.unknown_type', `Unknown gateway type: ${type}`);
    const draft: GatewayState = { id: this.ids.uuid(), type, ...this.fields(input), secretHints: {}, version: 0 };
    return this.persist(actor, draft, input.credentials, {}, true);
  }

  async update(actor: Principal, id: string, input: GatewayInput): Promise<GatewayState> {
    const current = await this.get(id);
    const saved = await this.secretsOf(id);
    return this.persist(actor, { ...current, ...this.fields(input) }, input.credentials, saved, false);
  }

  /** Calls the gateway with the saved credentials. Throws ProviderUnavailable with a readable reason. */
  async test(id: string): Promise<void> {
    const gateway = await this.get(id);
    await (await this.providerFor(gateway)).testConnection();
  }

  /** For payments: the adapter for a gateway, with its decrypted credentials. */
  async provider(id: string): Promise<{ gateway: GatewayState; provider: PaymentProviderPort }> {
    const gateway = await this.get(id);
    return { gateway, provider: await this.providerFor(gateway) };
  }

  private async providerFor(gateway: GatewayState): Promise<PaymentProviderPort> {
    const secrets = await this.secretsOf(gateway.id);
    const kind = gatewayType(gateway.type)!;
    const missing = kind.credentials.filter((field) => !secrets[field.key]);
    if (missing.length > 0) throw new ProviderUnavailable(`Enter ${missing.map((field) => field.label).join(' and ')} first`);
    return this.providers.create(gateway.type, gateway.config, secrets);
  }

  private fields(input: GatewayInput) {
    return { name: input.name, enabled: input.enabled, mode: input.mode, position: input.position, config: input.config };
  }

  private async secretsOf(id: string): Promise<Record<string, string>> {
    const sealed = await this.gateways.sealedSecrets(id);
    return sealed ? (JSON.parse(this.sealer.open(sealed)) as Record<string, string>) : {};
  }

  private async persist(
    actor: Principal,
    draft: GatewayState,
    incoming: Readonly<Record<string, string>>,
    saved: Readonly<Record<string, string>>,
    isNew: boolean,
  ): Promise<GatewayState> {
    const { config, secrets } = checkGateway(draft, incoming, saved);
    const changedSecrets = Object.keys(secrets).filter((key) => secrets[key] !== saved[key]);
    const sealed = Object.keys(secrets).length > 0 ? this.sealer.seal(JSON.stringify(secrets)) : null;
    const state: GatewayState = {
      ...draft,
      config,
      secretHints: Object.fromEntries(Object.entries(secrets).map(([key, value]) => [key, hint(value)])),
    };
    await this.gateways.save(state, sealed, isNew, {
      actorId: actor.accountId,
      action: isNew ? 'payments.gateway_created' : 'payments.gateway_updated',
      targetType: 'payment_gateway',
      targetId: state.id,
      // Which credentials changed is recorded; their values never are.
      after: { type: state.type, name: state.name, enabled: state.enabled, mode: state.mode, position: state.position, config, credentialsChanged: changedSecrets },
    });
    return { ...state, version: state.version + 1 };
  }
}
