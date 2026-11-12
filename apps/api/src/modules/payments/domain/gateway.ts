import { DomainError } from '../../../shared-kernel';

export type GatewayMode = 'test' | 'live';

export interface CredentialField {
  readonly key: string;
  readonly label: string;
  readonly help: string;
  /** Prefixes a key must start with in each mode, so a live key is never saved as test (or the reverse). */
  readonly prefixes?: Readonly<Record<GatewayMode, string>>;
}

export interface ConfigField {
  readonly key: string;
  readonly label: string;
  readonly help: string;
  readonly default: string;
}

export interface GatewayType {
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly credentials: readonly CredentialField[];
  readonly config: readonly ConfigField[];
  /** What staff paste into the gateway's dashboard, besides the webhook address. */
  readonly webhookNote: string;
}

/**
 * The kinds of gateway Vendra can talk to. Each needs an adapter in code; everything about a
 * particular gateway account (keys, mode, name, order, on or off) is configured by staff.
 * Adding a new kind means one adapter file and one entry here.
 */
export const GATEWAY_TYPES: readonly GatewayType[] = [
  {
    type: 'paystack',
    label: 'Paystack',
    description: 'Cards, bank transfer, USSD and more. Amounts are sent in kobo.',
    credentials: [
      {
        key: 'secretKey',
        label: 'Secret key',
        help: 'Paystack dashboard, Settings, API Keys & Webhooks. Also used to check webhook signatures.',
        prefixes: { test: 'sk_test_', live: 'sk_live_' },
      },
    ],
    config: [{ key: 'apiBaseUrl', label: 'API address', help: 'Leave as it is unless Paystack tells you otherwise.', default: 'https://api.paystack.co' }],
    webhookNote: 'In the Paystack dashboard, set the Webhook URL to the address below.',
  },
  {
    type: 'flutterwave',
    label: 'Flutterwave',
    description: 'Cards, bank transfer, USSD and mobile money. Amounts are sent in naira.',
    credentials: [
      {
        key: 'secretKey',
        label: 'Secret key',
        help: 'Flutterwave dashboard, Settings, API Keys.',
        prefixes: { test: 'FLWSECK_TEST-', live: 'FLWSECK-' },
      },
      {
        key: 'webhookHash',
        label: 'Webhook secret hash',
        help: 'Choose a long random value and enter the same value in Flutterwave, Settings, Webhooks, Secret hash.',
      },
    ],
    config: [
      { key: 'apiBaseUrl', label: 'API address', help: 'Leave as it is unless Flutterwave tells you otherwise.', default: 'https://api.flutterwave.com/v3' },
    ],
    webhookNote: 'In the Flutterwave dashboard, set the Webhook URL to the address below and the Secret hash to the value you entered here.',
  },
];

export const gatewayType = (type: string): GatewayType | undefined => GATEWAY_TYPES.find((entry) => entry.type === type);

export interface GatewayState {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly mode: GatewayMode;
  readonly position: number;
  readonly config: Readonly<Record<string, string>>;
  /** Last four characters of each saved credential, for display. Never the credential itself. */
  readonly secretHints: Readonly<Record<string, string>>;
  readonly version: number;
}

const invalid = (message: string) => new DomainError('gateway.invalid', message);

export function hint(secret: string): string {
  return secret.length <= 8 ? '••••' : `••••${secret.slice(-4)}`;
}

/** Checks a gateway's settings and the credentials being saved. Blank credentials keep the saved ones. */
export function checkGateway(
  state: GatewayState,
  incoming: Readonly<Record<string, string>>,
  saved: Readonly<Record<string, string>>,
): { config: Record<string, string>; secrets: Record<string, string> } {
  const kind = gatewayType(state.type);
  if (!kind) throw invalid(`Unknown gateway type: ${state.type}`);
  const name = state.name.trim();
  if (name.length < 2 || name.length > 60) throw invalid('Names are 2 to 60 characters, such as "Paystack" or "Card payments"');
  if (!Number.isInteger(state.position) || state.position < 0 || state.position > 100) throw invalid('Order must be a whole number from 0 to 100');

  const config: Record<string, string> = {};
  for (const field of kind.config) {
    const value = (state.config[field.key] ?? '').trim() || field.default;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw invalid(`${field.label} must be a full address starting with https://`);
    }
    // http is allowed only for a gateway running on this machine, such as a local test double.
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw invalid(`${field.label} must start with https://`);
    config[field.key] = value.replace(/\/+$/, '');
  }

  const secrets: Record<string, string> = {};
  for (const field of kind.credentials) {
    const value = (incoming[field.key] ?? '').trim() || saved[field.key] || '';
    if (value && field.prefixes && !value.startsWith(field.prefixes[state.mode])) {
      throw invalid(`${field.label} for ${state.mode} mode must start with ${field.prefixes[state.mode]}`);
    }
    if (value && (value.length < 8 || value.length > 500)) throw invalid(`${field.label} looks too short or too long`);
    if (value) secrets[field.key] = value;
  }
  if (state.enabled) {
    const missing = kind.credentials.filter((field) => !secrets[field.key]).map((field) => field.label);
    if (missing.length > 0) throw invalid(`Enter ${missing.join(' and ')} before turning this gateway on`);
  }
  return { config, secrets };
}
