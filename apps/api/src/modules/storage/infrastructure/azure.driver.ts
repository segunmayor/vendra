import { BlobServiceClient, ContainerClient, RestError, StorageSharedKeyCredential } from '@azure/storage-blob';
import { StorageDriver, StorageUnavailable } from '../application/ports';
import { network } from './s3.driver';

const TIMEOUT_MS = 60_000;

export interface AzureSettings {
  readonly accountName: string;
  readonly accountKey: string;
  readonly container: string;
  readonly endpoint?: string;
}

const MESSAGES: Readonly<Record<string, string>> = {
  AuthenticationFailed: 'The account key does not match the storage account.',
  AuthorizationFailure: 'Azure did not accept the request. Check the account key, and that the storage account’s network settings let this server in.',
  ContainerNotFound: 'The container does not exist and could not be created.',
  BlobNotFound: 'The file is not in the container. It may have been deleted there.',
  InvalidResourceName: 'The container name is not valid.',
  AccountIsDisabled: 'The storage account is disabled.',
};

/** Azure Blob Storage, with a shared account key. The container is created, private, on first use. */
export class AzureBlobDriver implements StorageDriver {
  private readonly container: ContainerClient;
  private ready: Promise<void> | null = null;

  constructor(settings: AzureSettings) {
    let credential: StorageSharedKeyCredential;
    try {
      credential = new StorageSharedKeyCredential(settings.accountName, settings.accountKey);
    } catch {
      throw new StorageUnavailable('The account key is not valid. Copy key1 or key2 from the storage account again.');
    }
    const endpoint = settings.endpoint || `https://${settings.accountName}.blob.core.windows.net`;
    this.container = new BlobServiceClient(endpoint, credential, { retryOptions: { maxTries: 3 } }).getContainerClient(settings.container);
  }

  async put(key: string, content: Uint8Array, contentType: string): Promise<void> {
    await this.ensureContainer();
    await this.run(() =>
      this.container.getBlockBlobClient(key).uploadData(content, { blobHTTPHeaders: { blobContentType: contentType }, abortSignal: AbortSignal.timeout(TIMEOUT_MS) }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const buffer = await this.run(() => this.container.getBlockBlobClient(key).downloadToBuffer(0, undefined, { abortSignal: AbortSignal.timeout(TIMEOUT_MS) }));
    return new Uint8Array(buffer);
  }

  async delete(key: string): Promise<void> {
    await this.run(() => this.container.getBlockBlobClient(key).deleteIfExists({ abortSignal: AbortSignal.timeout(TIMEOUT_MS) }));
  }

  private ensureContainer(): Promise<void> {
    this.ready ??= this.run(async () => {
      await this.container.createIfNotExists({ abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
    }).catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async run<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof StorageUnavailable) throw error;
      if (error instanceof RestError) {
        const known = error.code ? MESSAGES[error.code] : undefined;
        if (known) throw new StorageUnavailable(known);
        if (error.statusCode === 403) throw new StorageUnavailable(MESSAGES.AuthenticationFailed!);
        if (error.statusCode) throw new StorageUnavailable(`Azure refused the request (${error.code ?? error.statusCode}).`);
      }
      throw new StorageUnavailable(network(error));
    }
  }
}
