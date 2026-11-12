export type ApplicationErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  /** An outside service, such as a payment gateway, could not be reached or refused us. */
  | 'unavailable';

/** A use case refused a request. `code` is stable and safe to return to API clients. */
export class ApplicationError extends Error {
  constructor(
    readonly kind: ApplicationErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
