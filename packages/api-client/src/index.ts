import createClient from 'openapi-fetch';
import type { paths } from './generated/schema';

export type { components, paths } from './generated/schema';

export interface VendraClientOptions {
  /** Sent with every request, for example Authorization and the portal key. */
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof globalThis.fetch;
}

/** A typed client generated from the API contract. */
export function createVendraClient(baseUrl: string, options: VendraClientOptions = {}) {
  return createClient<paths>({ baseUrl, headers: options.headers, fetch: options.fetch });
}

export type VendraClient = ReturnType<typeof createVendraClient>;

/** The RFC 9457 body the API returns for every error. */
export interface ProblemDetails {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
}

export function isProblem(value: unknown): value is ProblemDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ProblemDetails).status === 'number' &&
    typeof (value as ProblemDetails).detail === 'string'
  );
}
