import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { DomainError } from '../../../shared-kernel';
import { DownloadLimits, RemoteFiles } from '../application/ports';
import { isNonPublicAddress } from './address-policy';

const MAX_REDIRECTS = 3;
const PORTS: Record<string, string> = { 'https:': '443', 'http:': '80' };

const fail = (message: string) => new DomainError('media.download_failed', message);

/**
 * Downloads photos for imports without becoming a way into the internal network (SSRF):
 * standard ports only, every resolved address checked and then the connection pinned to it
 * (so a DNS answer cannot change between check and use), redirects re-checked, a size cap
 * enforced while reading, and one deadline for the whole download.
 */
export class SafeRemoteFiles implements RemoteFiles {
  constructor(private readonly isBlocked: (address: string) => boolean = isNonPublicAddress) {}

  async download(raw: string, limits: DownloadLimits): Promise<Uint8Array> {
    const deadline = Date.now() + limits.timeoutMs;
    let url = new URL(raw);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      this.checkTarget(url, limits.allowHttp);
      const response = await this.request(url, deadline);
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        url = new URL(response.headers.location, url);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        throw fail(`The photo address answered with HTTP ${status}`);
      }
      return this.read(response, limits.maxBytes, deadline);
    }
    throw fail('The photo address redirected too many times');
  }

  private checkTarget(url: URL, allowHttp: boolean): void {
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) throw fail('The photo address must use https://');
    if (url.port && url.port !== PORTS[url.protocol]) throw fail('Photo addresses must use the standard web port');
    if (url.username || url.password) throw fail('Photo addresses cannot contain a user name or password');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && this.isBlocked(host)) throw fail('That photo address is on a private network');
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw fail('That photo address is on a private network');
  }

  private guardedLookup(): LookupFunction {
    return (hostname, options, callback) => {
      dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
        if (error) return callback(error, '', 0);
        if (addresses.length === 0 || addresses.some((entry) => this.isBlocked(entry.address))) {
          return callback(Object.assign(fail('That photo address is on a private network'), { code: 'EBLOCKED' }), '', 0);
        }
        const first = addresses[0]!;
        if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
        return callback(null, first.address, first.family);
      });
    };
  }

  private request(url: URL, deadline: number): Promise<IncomingMessage> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(fail('The photo took too long to download'));
    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const request = client.get(
        url,
        {
          lookup: this.guardedLookup(),
          timeout: remaining,
          headers: { accept: 'image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1', 'user-agent': 'VendraImageImport/1.0' },
          agent: false,
        },
        resolve,
      );
      request.on('timeout', () => request.destroy(fail('The photo took too long to download')));
      request.on('error', (error) => reject(error instanceof DomainError ? error : fail(`The photo could not be downloaded (${(error as NodeJS.ErrnoException).code ?? error.message})`)));
    });
  }

  private read(response: IncomingMessage, maxBytes: number, deadline: number): Promise<Uint8Array> {
    const tooLarge = () => fail(`Photos can be up to ${Math.floor(maxBytes / (1024 * 1024))} MB`);
    const declared = Number(response.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      response.destroy();
      return Promise.reject(tooLarge());
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => response.destroy(fail('The photo took too long to download')), Math.max(0, deadline - Date.now()));
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) return response.destroy(tooLarge());
        chunks.push(chunk);
      });
      response.on('end', () => {
        clearTimeout(timer);
        resolve(new Uint8Array(Buffer.concat(chunks)));
      });
      response.on('error', (error) => {
        clearTimeout(timer);
        reject(error instanceof DomainError ? error : fail('The photo download was interrupted'));
      });
      response.on('close', () => {
        clearTimeout(timer);
        if (!response.complete) reject(fail('The photo download was interrupted'));
      });
    });
  }
}
