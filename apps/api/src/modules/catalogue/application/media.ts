import { DomainError } from '../../../shared-kernel';
import { checkImage, checkVideo, MEDIA_EXTENSIONS } from '../domain/image-file';

export { IMAGE_HARD_LIMIT_BYTES } from '../domain/image-file';
import { DownloadLimits, Hasher, Ids, ImageAddresses, MediaStore, PublicFileUrls, RemoteFiles } from './ports';

const FILE = /^([0-9a-f-]{36})\.([a-z0-9]{3,4})$/;
const MAX_URL = 2000;

/** The address a stored photo is served at, relative to each portal. */
export { VIDEO_HARD_LIMIT_BYTES } from '../domain/image-file';

export const mediaPath = (id: string, extension: string): string => `/media/${id}.${extension}`;

const PATH = /^\/media\/([0-9a-f-]{36})\.[a-z0-9]{3,4}$/;
/** Public addresses change only when staff change a storage location or move files. */
const ADDRESS_TTL_MS = 60_000;
const ADDRESS_CACHE_SIZE = 10_000;

/** Product photos: downloaded once, checked by content, stored once per distinct file. */
export class ProductMediaService implements ImageAddresses {
  private readonly addresses = new Map<string, { at: number; url: string | null }>();
  private generation = -1;

  constructor(
    private readonly store: MediaStore,
    private readonly remote: RemoteFiles,
    private readonly hasher: Hasher,
    private readonly ids: Ids,
    private readonly publicFiles: PublicFileUrls,
  ) {}

  /**
   * Public (CDN) addresses for photos whose storage location serves them publicly. Others are
   * left out, and are loaded from their own path, through Vendra.
   */
  async resolve(paths: readonly string[]): Promise<Map<string, string>> {
    // Staff changed storage settings on this server: forget addresses at once (other servers
    // catch up within the cache time).
    const generation = this.publicFiles.generation();
    if (generation !== this.generation) {
      this.addresses.clear();
      this.generation = generation;
    }
    const result = new Map<string, string>();
    const now = Date.now();
    const missing: { path: string; id: string }[] = [];
    for (const path of new Set(paths)) {
      const cached = this.addresses.get(path);
      if (cached && now - cached.at < ADDRESS_TTL_MS) {
        if (cached.url) result.set(path, cached.url);
        continue;
      }
      const id = PATH.exec(path)?.[1];
      if (id) missing.push({ path, id });
    }
    if (missing.length === 0) return result;
    const objectIds = await this.store.objectIdsOf(missing.map((entry) => entry.id));
    const urls = await this.publicFiles.publicUrls([...objectIds.values()]);
    if (this.addresses.size + missing.length > ADDRESS_CACHE_SIZE) this.addresses.clear();
    for (const { path, id } of missing) {
      const objectId = objectIds.get(id);
      const url = objectId ? (urls.get(objectId) ?? null) : null;
      this.addresses.set(path, { at: now, url });
      if (url) result.set(path, url);
    }
    return result;
  }

  /** The public address of one photo, for redirecting old /media/ links. */
  async publicAddressOf(fileName: string): Promise<string | null> {
    const path = `/media/${fileName}`;
    return (await this.resolve([path])).get(path) ?? null;
  }

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

  /** Stores a video sent from Admin and returns the address to put on a product. */
  async uploadVideo(content: Uint8Array, maxBytes: number): Promise<string> {
    const { contentType, extension } = checkVideo(content, maxBytes);
    const saved = await this.store.save({ id: this.ids.uuid(), sha256: this.hasher.sha256(content), contentType, extension, content, sourceUrl: null });
    return mediaPath(saved.id, saved.extension);
  }

  /** The photo or video behind a served file name such as "<id>.jpg". Null for anything unknown or malformed. */
  async read(fileName: string): Promise<{ contentType: string; content: Uint8Array } | null> {
    const id = await this.idOf(fileName);
    if (!id) return null;
    return this.store.read(id);
  }

  /** Type and size, to answer range requests without reading the file. */
  async info(fileName: string): Promise<{ contentType: string; sizeBytes: number } | null> {
    const match = FILE.exec(fileName);
    if (!match || !MEDIA_EXTENSIONS[match[2]!]) return null;
    const info = await this.store.info(match[1]!);
    return info && info.contentType === MEDIA_EXTENSIONS[match[2]!] ? info : null;
  }

  /** Bytes start to end (both included): how browsers stream video and let shoppers skip ahead. */
  async readRange(fileName: string, start: number, end: number): Promise<Uint8Array | null> {
    const id = await this.idOf(fileName);
    return id ? this.store.readRange(id, start, end) : null;
  }

  private async idOf(fileName: string): Promise<string | null> {
    return (await this.info(fileName)) ? FILE.exec(fileName)![1]! : null;
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
