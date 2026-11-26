import { DomainError } from '../../../shared-kernel';
import { checkImage, IMAGE_EXTENSIONS } from '../domain/image-file';

export { IMAGE_HARD_LIMIT_BYTES } from '../domain/image-file';
import { DownloadLimits, Hasher, Ids, MediaStore, RemoteFiles } from './ports';

const FILE = /^([0-9a-f-]{36})\.([a-z]{3,4})$/;
const MAX_URL = 2000;

/** The address a stored photo is served at, relative to each portal. */
export const mediaPath = (id: string, extension: string): string => `/media/${id}.${extension}`;

/** Product photos: downloaded once, checked by content, stored once per distinct file. */
export class ProductMediaService {
  constructor(
    private readonly store: MediaStore,
    private readonly remote: RemoteFiles,
    private readonly hasher: Hasher,
    private readonly ids: Ids,
  ) {}

  /**
   * Downloads a photo and returns the address to put on a product. A URL already downloaded is
   * not fetched again, so a re-run import is fast; give a new URL to replace a photo.
   */
  async importFromUrl(raw: string, limits: DownloadLimits): Promise<string> {
    const url = this.checkUrl(raw, limits.allowHttp);
    const known = await this.store.findBySourceUrl(url);
    if (known) return mediaPath(known.id, known.extension);
    const content = await this.remote.download(url, limits);
    const { contentType, extension } = checkImage(content, limits.maxBytes);
    const saved = await this.store.save({ id: this.ids.uuid(), sha256: this.hasher.sha256(content), contentType, extension, content, sourceUrl: url });
    return mediaPath(saved.id, saved.extension);
  }

  /** Stores a photo sent from Admin and returns the address to put on a product. */
  async upload(content: Uint8Array, maxBytes: number): Promise<string> {
    if (content.length === 0) throw new DomainError('media.empty', 'That file is empty');
    const { contentType, extension } = checkImage(content, maxBytes);
    const saved = await this.store.save({ id: this.ids.uuid(), sha256: this.hasher.sha256(content), contentType, extension, content, sourceUrl: null });
    return mediaPath(saved.id, saved.extension);
  }

  /** The photo behind a served file name such as "<id>.jpg". Null for anything unknown or malformed. */
  async read(fileName: string): Promise<{ contentType: string; content: Uint8Array } | null> {
    const match = FILE.exec(fileName);
    if (!match || !IMAGE_EXTENSIONS[match[2]!]) return null;
    const media = await this.store.read(match[1]!);
    return media && media.contentType === IMAGE_EXTENSIONS[match[2]!] ? media : null;
  }

  private checkUrl(raw: string, allowHttp: boolean): string {
    const value = raw.trim();
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new DomainError('media.invalid_url', `"${value.slice(0, 80)}" is not a web address`);
    }
    if (value.length > MAX_URL) throw new DomainError('media.invalid_url', `Photo addresses can be up to ${MAX_URL} characters`);
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
      throw new DomainError('media.insecure_url', allowHttp ? 'Photo addresses must start with https:// or http://' : 'Photo addresses must start with https://');
    }
    if (url.username || url.password) throw new DomainError('media.invalid_url', 'Photo addresses cannot contain a user name or password');
    url.hash = '';
    return url.toString();
  }
}
