import { DomainError } from '../../../shared-kernel';

/**
 * Every business setting staff can change in the admin portal. Each has a safe range so a
 * typo cannot break the shop, and a default used until someone changes it.
 *
 * Not here on purpose: infrastructure that must exist before the database is reachable
 * (database URL, JWT secret, encryption key, ports), and hard safety caps that protect the
 * system rather than express a business choice (for example the 1,000-result search limit).
 */
type Base = { readonly group: SettingGroup; readonly label: string; readonly description: string; readonly public?: boolean };
export type SettingDefinition =
  | (Base & { readonly kind: 'integer'; readonly min: number; readonly max: number; readonly default: number; readonly unit?: string })
  | (Base & { readonly kind: 'decimal'; readonly min: number; readonly max: number; readonly default: number; readonly step: number })
  | (Base & { readonly kind: 'text' | 'longtext'; readonly maxLength: number; readonly default: string; readonly optional?: boolean })
  | (Base & { readonly kind: 'email' | 'phone' | 'url'; readonly default: string; readonly optional?: boolean })
  | (Base & { readonly kind: 'boolean'; readonly default: boolean });

export type SettingGroup = 'store' | 'shopping' | 'search' | 'security' | 'payments' | 'vendors';

export const GROUPS: Record<SettingGroup, { label: string; description: string }> = {
  store: { label: 'Store', description: 'Name, contact details and the words customers see.' },
  shopping: { label: 'Basket and checkout', description: 'Limits on baskets, and how long stock is held while customers pay.' },
  search: { label: 'Search', description: 'How forgiving search is of spelling mistakes.' },
  security: { label: 'Sign-in and security', description: 'Password rules, sign-in limits and how long people stay signed in.' },
  payments: { label: 'Payments and accounting', description: 'Where customers return after paying, and how payments are recorded in the ledger.' },
  vendors: { label: 'Seller applications', description: 'Whether businesses can apply to sell, and what they must send for verification.' },
};

export const SETTINGS = {
  'store.name': { group: 'store', kind: 'text', maxLength: 60, default: 'Vendra', public: true, label: 'Store name', description: 'Shown in the header, page titles and emails.' },
  'store.heroTitle': { group: 'store', kind: 'text', maxLength: 120, default: 'Everything you need, delivered with confidence.', public: true, label: 'Home page headline', description: 'The large headline on the home page.' },
  'store.heroSubtitle': { group: 'store', kind: 'longtext', maxLength: 300, default: 'Clear prices, verified payments and delivery you can follow from checkout to your door.', public: true, label: 'Home page subheading', description: 'The line under the headline.' },
  'store.paymentSafetyNote': { group: 'store', kind: 'longtext', maxLength: 300, default: 'Pay only on Vendra. Our riders never ask for payment at the door.', public: true, label: 'Payment safety message', description: 'Shown at checkout to protect customers from fraud.' },
  'store.supportEmail': { group: 'store', kind: 'email', default: '', optional: true, public: true, label: 'Support email', description: 'Where customers can write for help. Leave blank to hide.' },
  'store.supportPhone': { group: 'store', kind: 'phone', default: '', optional: true, public: true, label: 'Support phone', description: 'A Nigerian number customers can call. Leave blank to hide.' },
  'store.lowStockThreshold': { group: 'store', kind: 'integer', min: 0, max: 100, default: 5, unit: 'units', public: false, label: 'Low stock warning', description: 'At or below this many units, customers see "Only N left". 0 turns the warning off.' },

  'shopping.maxQuantityPerItem': { group: 'shopping', kind: 'integer', min: 1, max: 100, default: 10, unit: 'units', label: 'Most of one item per order', description: 'Stops one customer buying a whole shelf.' },
  'shopping.maxBasketLines': { group: 'shopping', kind: 'integer', min: 1, max: 200, default: 30, unit: 'items', label: 'Most different items in a basket', description: '' },
  'shopping.holdMinutes': { group: 'shopping', kind: 'integer', min: 5, max: 120, default: 15, unit: 'minutes', label: 'Stock hold while paying', description: 'How long checkout keeps items for a customer before returning them to sale.' },

  'search.typoTolerance': { group: 'search', kind: 'decimal', min: 0.3, max: 0.9, step: 0.05, default: 0.5, label: 'Spelling strictness', description: 'Lower finds more misspellings but more unrelated results. 0.5 is balanced.' },

  'security.passwordMinLength': { group: 'security', kind: 'integer', min: 8, max: 64, default: 12, unit: 'characters', label: 'Minimum password length', description: 'Applies to new and changed passwords.' },
  'security.failedSignInsPerAccount': { group: 'security', kind: 'integer', min: 3, max: 50, default: 5, unit: 'attempts', label: 'Failed sign-ins before an account is paused', description: '' },
  'security.failedSignInsPerAddress': { group: 'security', kind: 'integer', min: 10, max: 5000, default: 100, unit: 'attempts', label: 'Failed sign-ins before an IP address is paused', description: '' },
  'security.signInPauseMinutes': { group: 'security', kind: 'integer', min: 5, max: 1440, default: 15, unit: 'minutes', label: 'Sign-in pause', description: 'How far back failed attempts are counted.' },
  'security.accessTokenMinutes': { group: 'security', kind: 'integer', min: 5, max: 60, default: 15, unit: 'minutes', label: 'Access token lifetime', description: 'Shorter is safer; portals renew it automatically.' },
  'security.customerSessionDays': { group: 'security', kind: 'integer', min: 1, max: 90, default: 30, unit: 'days', label: 'Customers stay signed in for', description: 'Applies to new sign-ins.' },
  'security.vendorSessionDays': { group: 'security', kind: 'integer', min: 1, max: 30, default: 14, unit: 'days', label: 'Sellers stay signed in for', description: 'Applies to new sign-ins.' },
  'security.staffSessionHours': { group: 'security', kind: 'integer', min: 1, max: 24, default: 12, unit: 'hours', label: 'Staff stay signed in for', description: 'Applies to new sign-ins.' },
  'security.staffMfaRequired': { group: 'security', kind: 'boolean', default: true, label: 'Staff must use two-step sign-in', description: 'Staff without an authenticator app are asked to set one up before they can use Admin. Refunds, gateway keys and resetting two-step sign-in always need it, whatever this says.' },

  'payments.storefrontUrl': { group: 'payments', kind: 'url', default: 'http://localhost:3000', label: 'Customer site address', description: 'Customers return here after paying, for example https://vendra.ng.' },
  'payments.apiUrl': { group: 'payments', kind: 'url', default: 'http://localhost:4000', label: 'API address', description: 'Used to build the webhook address you enter in each gateway dashboard.' },
  'payments.ledgerClearingAccount': { group: 'payments', kind: 'text', maxLength: 20, default: '1100', label: 'Ledger account for money held by gateways', description: 'Debited when a payment succeeds, credited when a refund is confirmed.' },
  'payments.ledgerPrepaymentAccount': { group: 'payments', kind: 'text', maxLength: 20, default: '2100', label: 'Ledger account for customer prepayments', description: 'Credited when a payment succeeds, until the order is delivered. Debited when the order is delivered or a refund is confirmed.' },
  'payments.ledgerSalesAccount': { group: 'payments', kind: 'text', maxLength: 20, default: '4000', label: 'Ledger account for sales', description: 'Credited with the price of the items when an order is delivered.' },
  'payments.ledgerDeliveryIncomeAccount': { group: 'payments', kind: 'text', maxLength: 20, default: '4100', label: 'Ledger account for delivery charges', description: 'Credited with the delivery charge when an order is delivered.' },

  'vendors.applicationsOpen': { group: 'vendors', kind: 'boolean', default: true, label: 'Accept new seller applications', description: 'When off, businesses can still sign in and finish applications they started, but cannot start new ones.' },
  'vendors.requireRegistrationCertificate': { group: 'vendors', kind: 'boolean', default: true, label: 'Require the CAC registration certificate', description: '' },
  'vendors.requireOwnerId': { group: 'vendors', kind: 'boolean', default: true, label: "Require the owner or director's ID", description: 'For example a national ID card, international passport or driver\'s licence.' },
  'vendors.requireProofOfAddress': { group: 'vendors', kind: 'boolean', default: true, label: 'Require proof of business address', description: 'For example a recent utility bill.' },
  'vendors.requireTaxCertificate': { group: 'vendors', kind: 'boolean', default: false, label: 'Require the TIN certificate', description: '' },
  'vendors.maxDocumentMb': { group: 'vendors', kind: 'integer', min: 1, max: 10, default: 5, unit: 'MB', label: 'Largest document file', description: 'PDF or photo. 10 MB is the most the system accepts.' },
  'vendors.approvedMessage': { group: 'vendors', kind: 'longtext', maxLength: 500, default: 'Your business is verified. Selling opens soon, and we will contact you when you can add products.', label: 'Message to approved sellers', description: 'Shown on the seller portal once an application is approved.' },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]['default'] extends number
  ? number
  : (typeof SETTINGS)[K]['default'] extends boolean
    ? boolean
    : string;

export const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(SETTINGS, key);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^(?:\+?234|0)[789][01]\d{8}$/;

const invalid = (definition: SettingDefinition, message: string) => new DomainError('settings.invalid_value', `${definition.label}: ${message}`);

/** Checks and normalises a value for a setting. Throws with a message naming the setting. */
export function parseValue(key: SettingKey, raw: unknown): string | number | boolean {
  const definition = SETTINGS[key] as SettingDefinition;
  switch (definition.kind) {
    case 'integer':
    case 'decimal': {
      const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(definition, 'enter a number');
      if (definition.kind === 'integer' && !Number.isInteger(value)) throw invalid(definition, 'enter a whole number');
      if (value < definition.min || value > definition.max) throw invalid(definition, `must be between ${definition.min} and ${definition.max}`);
      return value;
    }
    case 'boolean':
      if (typeof raw !== 'boolean') throw invalid(definition, 'must be on or off');
      return raw;
    default: {
      if (typeof raw !== 'string') throw invalid(definition, 'enter text');
      const value = raw.trim();
      const optional = 'optional' in definition && definition.optional;
      if (value === '') {
        if (optional) return '';
        throw invalid(definition, 'cannot be blank');
      }
      if ((definition.kind === 'text' || definition.kind === 'longtext') && value.length > definition.maxLength) {
        throw invalid(definition, `use at most ${definition.maxLength} characters`);
      }
      if (definition.kind === 'email' && !EMAIL.test(value)) throw invalid(definition, 'enter a valid email address');
      if (definition.kind === 'phone') {
        const compact = value.replace(/[\s-]/g, '');
        if (!PHONE.test(compact)) throw invalid(definition, 'enter a Nigerian phone number');
        return `+234${compact.replace(/^(?:\+?234|0)/, '')}`;
      }
      if (definition.kind === 'url') {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          throw invalid(definition, 'enter a full address starting with https://');
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid(definition, 'must start with https://');
        if (url.search || url.hash) throw invalid(definition, 'must not include ? or #');
        return url.toString().replace(/\/+$/, '');
      }
      return value;
    }
  }
}
