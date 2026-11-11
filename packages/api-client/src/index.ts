import createClient from 'openapi-fetch';
import type { paths } from './generated/schema';

export type { components, paths } from './generated/schema';

/** A typed client generated from the API contract. */
export function createVendraClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}
