import { MutableFile, Storage } from 'megajs';
import { StorageDriver, StorageUnavailable } from '../application/ports';
import { network } from './s3.driver';

const TIMEOUT_MS = 120_000;

export interface MegaSettings {
  readonly email: string;
  readonly password: string;
  readonly folder: string;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StorageUnavailable('MEGA took too long to answer. Try again.')), TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function describe(error: unknown): string {
  if (error instanceof StorageUnavailable) return error.message;
  const message = error instanceof Error ? error.message : '';
  if (/ENOENT|EBLOCKED|EKEY|incorrect|password|EEXPIRED/i.test(message)) return 'MEGA did not accept the email and password.';
  if (/EMFAREQUIRED|second factor|2fa/i.test(message)) return 'This MEGA account has two-step sign-in turned on. Use an account without it.';
  if (/EOVERQUOTA|quota|bandwidth|ETOOMANY|EAGAIN/i.test(message)) return 'MEGA refused because the account is over its storage or transfer limit. Try later or use a bigger plan.';
  return network(error);
}

/**
 * A MEGA cloud drive. Signs in once and keeps the session. Keys such as
 * "product-media/2026/11/<id>.png" become folders under the chosen top folder. Operations run
 * one at a time: MEGA limits parallel requests per account.
 */
export class MegaDriver implements StorageDriver {
  private storage: Promise<Storage> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly settings: MegaSettings) {}

  put(key: string, content: Uint8Array, _contentType: string): Promise<void> {
    return this.serial(async () => {
      const { folder, name } = await this.folderFor(key, true);
      const existing = folder.children?.find((child) => child.name === name && !child.directory);
      if (existing) await existing.delete(true);
      // The typings say Writable; at run time it is megajs's upload stream, with `complete`.
      const upload = folder.upload({ name, size: content.length }, Buffer.from(content)) as unknown as { complete: Promise<MutableFile> };
      await upload.complete;
    });
  }

  get(key: string): Promise<Uint8Array> {
    return this.serial(async () => {
      const file = await this.fileFor(key);
      if (!file) throw new StorageUnavailable('The file is not in the MEGA folder. It may have been deleted there.');
      return new Uint8Array(await file.downloadBuffer({}));
    });
  }

  getRange(key: string, start: number, end: number): Promise<Uint8Array> {
    return this.serial(async () => {
      const file = await this.fileFor(key);
      if (!file) throw new StorageUnavailable('The file is not in the MEGA folder. It may have been deleted there.');
      // megajs counts `end` as included, like HTTP ranges, but reads an `end` of 0 as "to the
      // end of the file": trim to the bytes asked for.
      return new Uint8Array(await file.downloadBuffer({ start, end })).subarray(0, end - start + 1);
    });
  }

  delete(key: string): Promise<void> {
    return this.serial(async () => {
      const file = await this.fileFor(key);
      if (file) await file.delete(true);
    });
  }

  async close(): Promise<void> {
    const storage = this.storage;
    this.storage = null;
    if (storage) await (await storage.catch(() => null))?.close();
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      try {
        return await withTimeout(work());
      } catch (error) {
        // A broken session is opened again on the next call.
        if (!(error instanceof StorageUnavailable)) this.storage = null;
        throw new StorageUnavailable(describe(error));
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private session(): Promise<Storage> {
    this.storage ??= new Storage({ email: this.settings.email, password: this.settings.password, keepalive: false }).ready.catch((error: unknown) => {
      this.storage = null;
      throw error;
    });
    return this.storage;
  }

  private async folderFor(key: string, create: boolean): Promise<{ folder: MutableFile; name: string }> {
    const storage = await this.session();
    const parts = [this.settings.folder, ...key.split('/')];
    const name = parts.pop()!;
    let folder = storage.root;
    for (const part of parts) {
      let next = folder.children?.find((child) => child.directory && child.name === part);
      if (!next) {
        if (!create) throw new StorageUnavailable('The file is not in the MEGA folder. It may have been deleted there.');
        next = await folder.mkdir(part);
      }
      folder = next;
    }
    return { folder, name };
  }

  private async fileFor(key: string): Promise<MutableFile | undefined> {
    const { folder, name } = await this.folderFor(key, false).catch((error: unknown) => {
      if (error instanceof StorageUnavailable) return { folder: null, name: '' };
      throw error;
    });
    return folder?.children?.find((child) => child.name === name && !child.directory);
  }
}
