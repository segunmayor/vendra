import { ProviderUnavailable } from '../application/ports';

const TIMEOUT_MS = 15_000;

/** Calls a gateway API with a timeout. Any failure becomes ProviderUnavailable, never a raw network error. */
export async function callGateway<T>(
  label: string,
  url: string,
  init: { method: 'GET' | 'POST'; secret: string; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: { authorization: `Bearer ${init.secret}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ProviderUnavailable(`Could not reach ${label}. Please try again.`);
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) throw new ProviderUnavailable(`${label} rejected the credentials`);
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'message' in body && typeof body.message === 'string' ? body.message.slice(0, 200) : `status ${response.status}`;
    throw new ProviderUnavailable(`${label} refused the request: ${message}`);
  }
  return body as T;
}

/** "1234.5" or 1234.5 naira to exact kobo. Refuses anything that is not a plain amount. */
export function majorToMinor(value: unknown): bigint {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new ProviderUnavailable(`Gateway returned an unreadable amount: ${String(value).slice(0, 30)}`);
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

export function minorToMajor(minor: bigint): string {
  const whole = minor / 100n;
  const fraction = (minor % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}
