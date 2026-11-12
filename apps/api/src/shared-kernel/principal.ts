export type Audience = 'store' | 'admin' | 'vendor';

/** The authenticated caller, resolved fresh from the database on every request. */
export interface Principal {
  readonly accountId: string;
  readonly sessionId: string;
  readonly audience: Audience;
  readonly permissions: readonly string[];
  /** True only when this staff session passed a second factor (an authenticator code). */
  readonly mfa?: boolean;
}

export interface AuditEntry {
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
  readonly ipAddress?: string;
}
