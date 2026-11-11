import { ApplicationError, Audience, DomainError, Principal } from '../../../shared-kernel';
import { Account, assertPasswordAllowed, normalizeEmail } from '../domain/account';
import {
  AccessTokenService,
  AccountRepository,
  AuditTrail,
  Clock,
  LoginThrottle,
  NewSession,
  PasswordHasher,
  Secrets,
  SessionRepository,
} from './ports';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Absolute lifetimes. Rotating a token never extends them. */
const SESSION_LIFETIME_MS: Record<Audience, number> = {
  store: 30 * DAY,
  vendor: 14 * DAY,
  admin: 12 * HOUR,
};

export const THROTTLE_WINDOW_MS = 15 * 60_000;
export const EMAIL_FAILURE_LIMIT = 5;
export const IP_FAILURE_LIMIT = 100;

export interface IssuedSession {
  readonly accountId: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

export interface AccountProfile {
  readonly id: string;
  readonly audience: Audience;
  readonly email: string;
  readonly permissions: readonly string[];
}

/** One message for every failure, so responses do not reveal which accounts exist. */
const invalidCredentials = (): ApplicationError =>
  new ApplicationError('unauthenticated', 'auth.invalid_credentials', 'Incorrect email or password');
const sessionInvalid = (): ApplicationError =>
  new ApplicationError('unauthenticated', 'auth.session_invalid', 'Please sign in again');

export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: AccessTokenService,
    private readonly secrets: Secrets,
    private readonly throttle: LoginThrottle,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async register(audience: Exclude<Audience, 'admin'>, email: string, password: string): Promise<IssuedSession> {
    assertPasswordAllowed(password);
    const now = this.clock.now();
    const account = Account.register({
      id: this.secrets.uuid(),
      audience,
      email,
      passwordHash: await this.hasher.hash(password),
      now,
    });
    await this.accounts.insert(account);
    return this.openSession(account.snapshot.id, audience, now);
  }

  async login(audience: Audience, rawEmail: string, password: string, ip: string): Promise<IssuedSession> {
    const now = this.clock.now();
    let email: string;
    try {
      email = normalizeEmail(rawEmail);
    } catch (error) {
      if (error instanceof DomainError) throw invalidCredentials();
      throw error;
    }

    const emailKey = `email:${audience}:${email}`;
    const ipKey = `ip:${ip}`;
    const blocked = await this.throttle.isBlocked(
      [
        { key: emailKey, limit: EMAIL_FAILURE_LIMIT },
        { key: ipKey, limit: IP_FAILURE_LIMIT },
      ],
      new Date(now.getTime() - THROTTLE_WINDOW_MS),
    );
    if (blocked) {
      throw new ApplicationError('rate_limited', 'auth.too_many_attempts', 'Too many attempts. Try again later.');
    }

    const account = await this.accounts.findByEmail(audience, email);
    // Hash even when the account is missing, so response time does not reveal it.
    this.dummyHash ??= this.hasher.hash(this.secrets.refreshToken());
    const hash = account?.snapshot.passwordHash ?? (await this.dummyHash);
    const passwordMatches = await this.hasher.verify(hash, password);

    if (!account || !passwordMatches || !account.isActive) {
      await this.throttle.recordFailure([emailKey, ipKey], now);
      if (audience === 'admin') {
        await this.audit.record({
          actorId: account?.snapshot.id ?? null,
          action: 'auth.login_failed',
          targetType: 'account',
          targetId: email,
          ipAddress: ip,
        });
      }
      throw invalidCredentials();
    }

    await this.throttle.clear(emailKey);
    const issued = await this.openSession(account.snapshot.id, audience, now);
    if (audience === 'admin') {
      await this.audit.record({
        actorId: account.snapshot.id,
        action: 'auth.login',
        targetType: 'account',
        targetId: account.snapshot.id,
        ipAddress: ip,
      });
    }
    return issued;
  }

  async refresh(audience: Audience, refreshToken: string): Promise<IssuedSession> {
    const now = this.clock.now();
    const session = await this.sessions.findByTokenHash(this.secrets.hashToken(refreshToken));
    if (!session || session.audience !== audience) throw sessionInvalid();
    if (session.revokedAt) {
      await this.handleReuse(session.familyId, session.accountId, now);
      throw sessionInvalid();
    }
    if (session.expiresAt <= now || session.accountStatus !== 'active') throw sessionInvalid();

    const token = this.secrets.refreshToken();
    const next: NewSession = {
      id: this.secrets.uuid(),
      accountId: session.accountId,
      familyId: session.familyId,
      refreshTokenHash: this.secrets.hashToken(token),
      expiresAt: session.expiresAt,
    };
    if (!(await this.sessions.rotate(session.id, next, now))) {
      await this.handleReuse(session.familyId, session.accountId, now);
      throw sessionInvalid();
    }
    return this.issue(next, token, audience);
  }

  /** Always succeeds, so a client can safely log out with a stale token. */
  async logout(audience: Audience, refreshToken: string): Promise<void> {
    const session = await this.sessions.findByTokenHash(this.secrets.hashToken(refreshToken));
    if (session && session.audience === audience) {
      await this.sessions.revokeFamily(session.familyId, this.clock.now());
    }
  }

  /** Checks the token, then current database state, so revocation applies at once. */
  async authenticate(token: string, audience: Audience): Promise<Principal> {
    const claims = this.tokens.verify(token, audience);
    if (!claims) throw sessionInvalid();
    const found = await this.sessions.findWithPermissions(claims.sessionId);
    if (
      !found ||
      found.session.accountId !== claims.accountId ||
      found.session.audience !== audience ||
      found.session.revokedAt !== null ||
      found.session.expiresAt <= this.clock.now() ||
      found.session.accountStatus !== 'active'
    ) {
      throw sessionInvalid();
    }
    return { ...claims, permissions: found.permissions };
  }

  async profile(principal: Principal): Promise<AccountProfile> {
    const account = await this.accounts.findById(principal.accountId);
    if (!account) throw sessionInvalid();
    const { id, audience, email } = account.snapshot;
    return { id, audience, email, permissions: principal.permissions };
  }

  /** Signs out every device, including the current one. */
  async changePassword(principal: Principal, current: string, next: string): Promise<void> {
    assertPasswordAllowed(next);
    const account = await this.accounts.findById(principal.accountId);
    if (!account) throw sessionInvalid();
    if (!(await this.hasher.verify(account.snapshot.passwordHash, current))) throw invalidCredentials();
    account.changePassword(await this.hasher.hash(next));
    await this.accounts.save(account, {
      revokeSessionsAt: this.clock.now(),
      audit: {
        actorId: principal.accountId,
        action: 'auth.password_changed',
        targetType: 'account',
        targetId: principal.accountId,
      },
    });
  }

  private async handleReuse(familyId: string, accountId: string, now: Date): Promise<void> {
    // Nothing live means an already-ended session, such as a token used after logout.
    if ((await this.sessions.revokeFamily(familyId, now)) === 0) return;
    await this.audit.record({
      actorId: accountId,
      action: 'auth.refresh_token_reuse',
      targetType: 'session_family',
      targetId: familyId,
    });
  }

  private async openSession(accountId: string, audience: Audience, now: Date): Promise<IssuedSession> {
    const token = this.secrets.refreshToken();
    const session: NewSession = {
      id: this.secrets.uuid(),
      accountId,
      familyId: this.secrets.uuid(),
      refreshTokenHash: this.secrets.hashToken(token),
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS[audience]),
    };
    await this.sessions.create(session);
    return this.issue(session, token, audience);
  }

  private issue(session: NewSession, refreshToken: string, audience: Audience): IssuedSession {
    const access = this.tokens.issue({ accountId: session.accountId, sessionId: session.id, audience });
    return {
      accountId: session.accountId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: session.expiresAt,
    };
  }
}
