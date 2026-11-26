import { DomainError } from '../../../shared-kernel';

/** How a location's files are written and read. Several location types share one driver. */
export type DriverKind = 's3' | 'azure_blob' | 'mega';

export interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly help: string;
  readonly required: boolean;
  readonly default?: string;
  readonly placeholder?: string;
  /** 'boolean' fields hold "true" or "false". */
  readonly kind?: 'text' | 'url' | 'boolean' | 'email';
}

export interface StorageType {
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly driver: DriverKind;
  readonly config: readonly FieldSpec[];
  readonly credentials: readonly FieldSpec[];
}

const PREFIX: FieldSpec = {
  key: 'prefix',
  label: 'Folder inside the bucket',
  help: 'Every file goes under this folder, so the bucket can be shared. Letters, digits, dots, dashes and slashes.',
  required: false,
  default: 'vendra',
};

const S3_KEYS: readonly FieldSpec[] = [
  { key: 'accessKeyId', label: 'Access key ID', help: 'From a user or key that can read, write and delete objects in this bucket only.', required: true },
  { key: 'secretAccessKey', label: 'Secret access key', help: 'Shown once when the key is created.', required: true },
];

/**
 * The storage services Vendra can keep files in. Each needs a driver in code; everything about a
 * particular account (bucket, keys, folder) is configured by staff in Admin. Adding a service
 * that speaks one of the existing protocols needs only an entry here.
 */
export const STORAGE_TYPES: readonly StorageType[] = [
  {
    type: 'aws_s3',
    label: 'Amazon S3',
    description: 'Amazon Web Services object storage. Keep the bucket private: Vendra serves every file itself.',
    driver: 's3',
    config: [
      { key: 'region', label: 'Region', help: 'Where the bucket is, such as af-south-1 (Cape Town) or eu-west-2 (London).', required: true, placeholder: 'af-south-1' },
      { key: 'bucket', label: 'Bucket', help: 'The bucket name, not its address.', required: true },
      PREFIX,
    ],
    credentials: S3_KEYS,
  },
  {
    type: 's3_compatible',
    label: 'S3-compatible storage',
    description:
      'Cloudflare R2, DigitalOcean Spaces, Backblaze B2, Wasabi, MinIO and other services that speak the S3 protocol.',
    driver: 's3',
    config: [
      {
        key: 'endpoint',
        label: 'Endpoint',
        help:
          'From the provider. R2: https://<account id>.r2.cloudflarestorage.com · Spaces: https://<region>.digitaloceanspaces.com · B2: https://s3.<region>.backblazeb2.com · Wasabi: https://s3.<region>.wasabisys.com',
        required: true,
        kind: 'url',
        placeholder: 'https://',
      },
      { key: 'region', label: 'Region', help: 'R2 uses "auto". Others use the region in the endpoint, such as fra1 or us-west-004.', required: true, default: 'auto' },
      { key: 'bucket', label: 'Bucket', help: 'The bucket name, not its address.', required: true },
      PREFIX,
      {
        key: 'pathStyle',
        label: 'Put the bucket in the path',
        help: 'Needed by MinIO and some others. Leave off for R2, Spaces, B2 and Wasabi.',
        required: false,
        default: 'false',
        kind: 'boolean',
      },
    ],
    credentials: S3_KEYS,
  },
  {
    type: 'google_cloud',
    label: 'Google Cloud Storage',
    description: 'Google Cloud object storage, through its S3-compatible interface with HMAC keys.',
    driver: 's3',
    config: [
      { key: 'bucket', label: 'Bucket', help: 'The bucket name, not its address.', required: true },
      PREFIX,
    ],
    credentials: [
      {
        key: 'accessKeyId',
        label: 'HMAC access ID',
        help: 'Cloud Storage, Settings, Interoperability: create a key for a service account that can manage objects in this bucket.',
        required: true,
      },
      { key: 'secretAccessKey', label: 'HMAC secret', help: 'Shown once when the key is created.', required: true },
    ],
  },
  {
    type: 'azure_blob',
    label: 'Azure Blob Storage',
    description: 'Microsoft Azure storage account. Keep the container private: Vendra serves every file itself.',
    driver: 'azure_blob',
    config: [
      { key: 'accountName', label: 'Storage account name', help: 'The account name, in lower case, such as vendrafiles.', required: true },
      { key: 'container', label: 'Container', help: 'Created if it does not exist yet.', required: true, default: 'vendra' },
      { key: 'prefix', label: 'Folder inside the container', help: PREFIX.help, required: false, default: 'vendra' },
      {
        key: 'endpoint',
        label: 'Blob service address',
        help: 'Leave empty for normal Azure accounts. Fill in only for Azure Government, Azure China or a local emulator.',
        required: false,
        kind: 'url',
      },
    ],
    credentials: [{ key: 'accountKey', label: 'Account key', help: 'Storage account, Security + networking, Access keys: key1 or key2.', required: true }],
  },
  {
    type: 'mega',
    label: 'MEGA',
    description:
      'MEGA cloud drive, signed in as a MEGA account. Suits small catalogues and backups; MEGA limits how much can be downloaded each day, so busy stores should use an object storage service.',
    driver: 'mega',
    config: [{ key: 'folder', label: 'Folder', help: 'A folder at the top of the drive. Created if it does not exist yet.', required: true, default: 'Vendra' }],
    credentials: [
      { key: 'email', label: 'Account email', help: 'Use an account only for the store. Accounts with two-step sign-in turned on cannot be used.', required: true, kind: 'email' },
      { key: 'password', label: 'Account password', help: '', required: true },
    ],
  },
];

export const storageType = (type: string): StorageType | undefined => STORAGE_TYPES.find((entry) => entry.type === type);

export interface LocationCheck {
  readonly at: Date;
  readonly ok: boolean;
  readonly message: string | null;
}

export interface LocationState {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly config: Readonly<Record<string, string>>;
  /** Last four characters of each saved credential, for display. Never the credential itself. */
  readonly secretHints: Readonly<Record<string, string>>;
  readonly active: boolean;
  readonly lastCheck: LocationCheck | null;
  readonly version: number;
}

const invalid = (message: string) => new DomainError('storage.invalid', message);

export function hint(secret: string): string {
  return secret.length <= 8 ? '••••' : `••••${secret.slice(-4)}`;
}

const RULES: Readonly<Record<string, { pattern: RegExp; message: string }>> = {
  region: { pattern: /^[a-z0-9-]{2,32}$/, message: 'Region is a short code such as af-south-1 or auto' },
  bucket: { pattern: /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, message: 'Bucket names are 3 to 63 lower-case letters, digits, dots and dashes' },
  accountName: { pattern: /^[a-z0-9]{3,24}$/, message: 'Storage account names are 3 to 24 lower-case letters and digits' },
  container: { pattern: /^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/, message: 'Container names are 3 to 63 lower-case letters, digits and single dashes' },
  prefix: { pattern: /^(?:[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)?$/, message: 'The folder may use letters, digits, dots, dashes and single slashes between parts' },
  folder: { pattern: /^[^/\\]{1,60}$/, message: 'The folder is a single name of up to 60 characters, without slashes' },
};

function checkUrl(field: FieldSpec, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid(`${field.label} must be a full address starting with https://`);
  }
  // http only for a service on this machine, such as a local MinIO or the Azure emulator.
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw invalid(`${field.label} must start with https://`);
  if (url.username || url.password || url.search || url.hash) throw invalid(`${field.label} must be a plain address, without a user name, password or ?query`);
  return value.replace(/\/+$/, '');
}

/** Checks a location's settings and the credentials being saved. Blank credentials keep the saved ones. */
export function checkLocation(
  state: Pick<LocationState, 'type' | 'name' | 'config'>,
  incoming: Readonly<Record<string, string>>,
  saved: Readonly<Record<string, string>>,
): { name: string; config: Record<string, string>; secrets: Record<string, string> } {
  const kind = storageType(state.type);
  if (!kind) throw invalid(`Unknown storage type: ${state.type}`);
  const name = state.name.trim();
  if (name.length < 2 || name.length > 60) throw invalid('Names are 2 to 60 characters, such as "Product photos on R2"');

  const config: Record<string, string> = {};
  for (const field of kind.config) {
    const raw = (state.config[field.key] ?? '').trim();
    const value = raw || field.default || '';
    if (!value) {
      if (field.required) throw invalid(`Enter the ${field.label.toLowerCase()}`);
      config[field.key] = '';
      continue;
    }
    if (value.length > 500) throw invalid(`${field.label} is too long`);
    if (field.kind === 'boolean') {
      if (value !== 'true' && value !== 'false') throw invalid(`${field.label} must be on or off`);
      config[field.key] = value;
    } else if (field.kind === 'url') {
      config[field.key] = checkUrl(field, value);
    } else {
      const rule = RULES[field.key];
      const cleaned = field.key === 'prefix' ? value.replace(/^\/+|\/+$/g, '') : value;
      if (rule && !rule.pattern.test(cleaned)) throw invalid(rule.message);
      config[field.key] = cleaned;
    }
  }

  const secrets: Record<string, string> = {};
  for (const field of kind.credentials) {
    const value = (incoming[field.key] ?? '').trim() || saved[field.key] || '';
    if (!value) {
      if (field.required) throw invalid(`Enter the ${field.label.toLowerCase()}`);
      continue;
    }
    if (value.length > 1000) throw invalid(`${field.label} is too long`);
    if (field.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw invalid(`${field.label} must be an email address`);
    secrets[field.key] = value;
  }
  return { name, config, secrets };
}

/** What a file is for. Part of its storage key, so the bucket is easy to browse. */
export type FilePurpose = 'product-media' | 'seller-documents';

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
};

/** The file extension for a checked content type. */
export const extensionFor = (contentType: string): string => EXTENSIONS[contentType] ?? 'bin';

/** "<prefix>/<purpose>/<yyyy>/<mm>/<id>.<ext>". Never includes a name a person chose. */
export function objectKey(prefix: string, purpose: FilePurpose, id: string, extension: string, now: Date): string {
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return [prefix, purpose, String(now.getUTCFullYear()), month, `${id}.${ext}`].filter(Boolean).join('/');
}
