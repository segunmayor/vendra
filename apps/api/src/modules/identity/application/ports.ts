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
  issue(claims: AccessClaims, ttlSeconds: number): { token: string; expiresAt: Date };
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
  /** Whether the sign-in passed a second factor. */
  readonly mfa: boolean;
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
  readonly mfaEnabled: boolean;
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

/** Time-based one-time codes (RFC 6238). */
export interface TotpPort {
  /** A new random secret, base32-encoded. */
  newSecret(): string;
  /** The otpauth:// address an authenticator app reads from a QR code. */
  uri(secret: string, accountName: string, issuer: string): string;
  /** The time step the code is valid for, or null if it is wrong. */
  match(secret: string, code: string, now: Date): number | null;
}

export interface RecoveryCodeGenerator {
  /** A new random code such as "K7QM-3XRT-9P". */
  next(): string;
}

/** Encrypts secrets at rest. */
export interface SecretSealer {
  seal(plaintext: string): string;
  open(sealed: string): string;
}

export interface MfaState {
  readonly accountId: string;
  readonly audience: Audience;
  readonly email: string;
  readonly sealedSecret: string | null;
  readonly enabledAt: Date | null;
  readonly lastStep: number | null;
}

export interface MfaChallengeView {
  readonly id: string;
  readonly accountId: string;
  readonly expiresAt: Date;
  readonly attempts: number;
  readonly usedAt: Date | null;
}

export interface MfaRepository {
  find(accountId: string): Promise<MfaState | null>;
  /** Stores a new secret awaiting confirmation. False if two-step sign-in is already on. */
  savePending(accountId: string, sealedSecret: string): Promise<boolean>;
  /**
   * In one transaction: turns two-step sign-in on, records the step used, replaces recovery
   * codes, marks `sessionId` as verified and ends every other session of the account.
   * False if it was already on.
   */
  enable(accountId: string, step: number, codeHashes: readonly string[], sessionId: string, now: Date, audit: AuditEntry): Promise<boolean>;
  /** Records a used step. False if this step or a later one was already used (a replay). */
  useStep(accountId: string, step: number): Promise<boolean>;
  /** Marks a recovery code used. False if it does not exist or was used already. */
  useRecoveryCode(accountId: string, codeHash: string, now: Date): Promise<boolean>;
  replaceRecoveryCodes(accountId: string, codeHashes: readonly string[], audit: AuditEntry): Promise<void>;
  unusedRecoveryCodes(accountId: string): Promise<number>;
  /** Turns two-step sign-in off, deletes recovery codes and ends every session. */
  reset(accountId: string, now: Date, audit: AuditEntry): Promise<void>;
  createChallenge(challenge: { id: string; accountId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findChallenge(tokenHash: string): Promise<MfaChallengeView | null>;
  recordChallengeAttempt(id: string): Promise<void>;
  /** Single use: false if it was already used. */
  consumeChallenge(id: string, now: Date): Promise<boolean>;
}
