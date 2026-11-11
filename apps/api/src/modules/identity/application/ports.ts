import { Audience, AuditEntry } from '../../../shared-kernel';
import { Account, AccountStatus } from '../domain/account';

export interface Clock {
  now(): Date;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface AccessClaims {
  readonly accountId: string;
  readonly sessionId: string;
  readonly audience: Audience;
}

export interface AccessTokenService {
  issue(claims: AccessClaims): { token: string; expiresAt: Date };
  /** Returns null for any token that is invalid, expired, or for another audience. */
  verify(token: string, audience: Audience): AccessClaims | null;
}

export interface Secrets {
  uuid(): string;
  refreshToken(): string;
  hashToken(token: string): string;
}

export interface NewSession {
  readonly id: string;
  readonly accountId: string;
  readonly familyId: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
}

export interface SessionView extends NewSession {
  readonly revokedAt: Date | null;
  readonly audience: Audience;
  readonly accountStatus: AccountStatus;
}

export interface SessionRepository {
  create(session: NewSession): Promise<void>;
  findByTokenHash(hash: string): Promise<SessionView | null>;
  /** Atomically retires `oldId` and creates `next`. False if `oldId` was already retired. */
  rotate(oldId: string, next: NewSession, now: Date): Promise<boolean>;
  /** Returns how many live sessions were revoked. */
  revokeFamily(familyId: string, now: Date): Promise<number>;
  findWithPermissions(id: string): Promise<{ session: SessionView; permissions: string[] } | null>;
}

export interface AccountRepository {
  findById(id: string): Promise<Account | null>;
  findByEmail(audience: Audience, email: string): Promise<Account | null>;
  countByAudience(audience: Audience): Promise<number>;
  /** Must throw an `account.email_taken` conflict if the email is already registered. */
  insert(account: Account, options?: { audit?: AuditEntry; roleIds?: readonly string[] }): Promise<void>;
  /** Saves state, events, audit entry and any session revocation in one transaction. */
  save(account: Account, options?: { audit?: AuditEntry; revokeSessionsAt?: Date }): Promise<void>;
}

export interface RoleView {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

export interface StaffView {
  readonly id: string;
  readonly email: string;
  readonly status: AccountStatus;
  readonly roles: readonly { id: string; name: string }[];
}

export interface RoleRepository {
  list(): Promise<RoleView[]>;
  findByIds(ids: readonly string[]): Promise<RoleView[]>;
  findByName(name: string): Promise<RoleView | null>;
  /** Must throw a `role.name_taken` conflict if the name is in use. */
  create(role: RoleView, audit: AuditEntry | null): Promise<void>;
  permissionsOf(accountId: string): Promise<string[]>;
  setAccountRoles(accountId: string, roleIds: readonly string[], audit: AuditEntry | null): Promise<void>;
  listStaff(): Promise<StaffView[]>;
}

export interface LoginThrottle {
  isBlocked(checks: readonly { key: string; limit: number }[], since: Date): Promise<boolean>;
  recordFailure(keys: readonly string[], now: Date): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface AuditRecord extends AuditEntry {
  readonly id: string;
  readonly createdAt: Date;
}

export interface AuditTrail {
  record(entry: AuditEntry): Promise<void>;
  list(limit: number, cursor?: string): Promise<AuditRecord[]>;
}
