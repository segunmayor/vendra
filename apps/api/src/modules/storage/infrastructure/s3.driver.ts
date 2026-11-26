import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { StorageDriver, StorageUnavailable } from '../application/ports';

const TIMEOUT_MS = 60_000;

export interface S3Settings {
  readonly endpoint?: string;
  readonly region: string;
  readonly bucket: string;
  readonly pathStyle: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const MESSAGES: Readonly<Record<string, string>> = {
  NoSuchBucket: 'The bucket does not exist. Check its name, and the region or endpoint.',
  InvalidAccessKeyId: 'The access key ID is not recognised.',
  SignatureDoesNotMatch: 'The secret access key does not match the access key ID.',
  AccessDenied: 'The key is not allowed to do this. It needs permission to read, write and delete objects in the bucket.',
  PermanentRedirect: 'The bucket is in a different region. Check the region.',
  AuthorizationHeaderMalformed: 'The region does not match the bucket. Check the region.',
  InvalidBucketName: 'The bucket name is not valid.',
  NoSuchKey: 'The file is not in the bucket. It may have been deleted there.',
};

/** Amazon S3 and every service that speaks its protocol (R2, Spaces, B2, Wasabi, MinIO, Google Cloud Storage). */
export class S3Driver implements StorageDriver {
  private readonly client: S3Client;

  constructor(private readonly settings: S3Settings) {
    this.client = new S3Client({
      region: settings.region,
      endpoint: settings.endpoint || undefined,
      forcePathStyle: settings.pathStyle,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      maxAttempts: 3,
      // Some S3-compatible services reject the newer optional checksums.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, content: Uint8Array, contentType: string): Promise<void> {
    await this.run(() =>
      this.client.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, Body: content, ContentType: contentType, ContentLength: content.length }), {
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const reply = await this.run(() => this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }), { abortSignal: AbortSignal.timeout(TIMEOUT_MS) }));
    if (!reply.Body) throw new StorageUnavailable('The storage service returned an empty file.');
    return reply.Body.transformToByteArray();
  }

  async delete(key: string): Promise<void> {
    await this.run(() => this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }), { abortSignal: AbortSignal.timeout(TIMEOUT_MS) }));
  }

  async close(): Promise<void> {
    this.client.destroy();
  }

  private async run<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw new StorageUnavailable(describe(error));
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof S3ServiceException) {
    const known = MESSAGES[error.name];
    if (known) return known;
    if (error.$metadata.httpStatusCode === 403) return MESSAGES.AccessDenied!;
    if (error.$metadata.httpStatusCode === 404) return 'The bucket or file was not found. Check the bucket name and endpoint.';
    return `The storage service refused the request (${error.name}).`;
  }
  return network(error);
}

/** Readable reasons for failures before the service answered. */
export function network(error: unknown): string {
  const code = (error as { code?: string; name?: string })?.code ?? (error as { name?: string })?.name ?? '';
  const cause = (error as { cause?: { code?: string } })?.cause?.code ?? '';
  const all = `${code} ${cause}`;
  if (/ENOTFOUND|EAI_AGAIN/.test(all)) return 'The storage address could not be found. Check the endpoint, account name or region.';
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH/.test(all)) return 'The storage service refused the connection. Check the endpoint.';
  if (/TimeoutError|AbortError|ETIMEDOUT/.test(all)) return 'The storage service took too long to answer. Try again.';
  if (/CERT|SSL|TLS/.test(all)) return 'The storage service’s security certificate was not accepted. Check the endpoint.';
  return 'The storage service could not be reached. Check the settings and try again.';
}
