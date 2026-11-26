import { PublicFetcher, StorageUnavailable } from '../application/ports';

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 1024 * 1024;

/**
 * Opens a public address as a shopper's browser would: no credentials, following the CDN's
 * redirects. Only addresses staff entered for their storage location are ever fetched.
 */
export class HttpPublicFetcher implements PublicFetcher {
  async get(url: string): Promise<{ status: number; body: Uint8Array }> {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'cache-control': 'no-cache' } });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new StorageUnavailable('The public address answered with far more than the test file.');
        }
        chunks.push(value);
      }
    }
    return { status: response.status, body: new Uint8Array(Buffer.concat(chunks)) };
  }
}
