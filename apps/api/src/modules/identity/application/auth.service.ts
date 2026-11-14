import { ApplicationError, Audience, DomainError, Principal } from '../../../shared-kernel';
import { SettingsReader } from '../../settings';
import { Account, assertPasswordAllowed, normalizeEmail } from '../domain/account';
import { MfaChallenge, MfaService } from './mfa.service';
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

export interface IssuedSession {
  readonly accountId: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

/** For staff with two-step sign-in on, a correct password gives a challenge, not a session. */
export type LoginResult = IssuedSession | (MfaChallenge & { readonly mfaRequired: true });

export interface AccountProfile {
  readonly id: string;
  readonly audience: Audience;
  readonly email: string;
  readonly permissions: readonly string[];
  readonly mfa: {
    readonly enabled: boolean;
    readonly verified: boolean;
    /** True when this staff member must set up two-step sign-in before using Admin. */
    readonly setupRequired: boolean;
  };
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
    private readonly settings: SettingsReader,
    private readonly mfa: MfaService,
  ) {}

  /** Absolute session lifetime for new sessions. Rotating a token never extends it. */
  private async sessionLifetimeMs(audience: Audience): Promise<number> {
    if (audience === 'store') return (await this.settings.get('security.customerSessionDays')) * DAY;
    if (audience === 'vendor') return (await this.settings.get('security.vendorSessionDays')) * DAY;
    return (await this.settings.get('security.staffSessionHours')) * HOUR;
  }

  /** `ip` limits how many accounts one address can create, so sign-up cannot be scripted at scale. */
  async register(audience: Exclude<Audience, 'admin'>, email: string, password: string, ip: string): Promise<IssuedSession> {
    assertPasswordAllowed(password, await this.settings.get('security.passwordMinLength'));
    const now = this.clock.now();
    const key = `ip:register:${ip}`;
    const limit = await this.settings.get('security.registrationsPerAddressPerHour');
    if (await this.throttle.isBlocked([{ key, limit }], new Date(now.getTime() - HOUR))) {
      throw new ApplicationError('rate_limited', 'auth.too_many_registrations', 'Too many new accounts from your network. Try again later.');
    }
    await this.throttle.recordFailure([key], now);
    const account = Account.register({
      id: this.secrets.uuid(),
      audience,
      email,
      passwordHash: await this.hasher.hash(password),
      now,
    });
    await this.accounts.insert(account);
    return this.openSession(account.snapshot.id, audience, now, false);
  }

  async login(audience: Audience, rawEmail: string, password: string, ip: string): Promise<LoginResult> {
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
    const [perAccount, perAddress, pauseMinutes] = await this.settings.getMany([
      'security.failedSignInsPerAccount',
      'security.failedSignInsPerAddress',
      'security.signInPauseMinutes',
    ] as const);
    const blocked = await this.throttle.isBlocked(
      [
        { key: emailKey, limit: perAccount },
        { key: ipKey, limit: perAddress },
      ],
      new Date(now.getTime() - pauseMinutes * 60_000),
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
    if (audience === 'admin' && (await this.mfa.isEnabled(account.snapshot.id))) {
      return { mfaRequired: true, ...(await this.mfa.openChallenge(account.snapshot.id)) };
    }
    const issued = await this.openSession(account.snapshot.id, audience, now, false);
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

  /** The second step of a staff sign-in: a code from the authenticator app, or a recovery code. */
  async completeMfaLogin(challengeToken: string, code: string, ip: string): Promise<IssuedSession> {
    const accountId = await this.mfa.completeChallenge(challengeToken, code);
    const account = await this.accounts.findById(accountId);
    if (!account || !account.isActive || account.snapshot.audience !== 'admin') throw invalidCredentials();
    const issued = await this.openSession(accountId, 'admin', this.clock.now(), true);
    await this.audit.record({ actorId: accountId, action: 'auth.login', targetType: 'account', targetId: accountId, ipAddress: ip, after: { mfa: true } });
    return issued;
  }

  /** Whether staff without a verified second factor are limited to setting one up. */
  staffMfaRequired(): Promise<boolean> {
    return this.mfa.staffRequired();
  }

  /** For other modules, such as payments, that need a customer's email address. */
  async emailOf(accountId: string): Promise<string | null> {
    return (await this.accounts.findById(accountId))?.snapshot.email ?? null;
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
      mfa: session.mfa,
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
    return { ...claims, permissions: found.permissions, mfa: found.session.mfa };
  }

  async profile(principal: Principal): Promise<AccountProfile> {
    const account = await this.accounts.findById(principal.accountId);
    if (!account) throw sessionInvalid();
    const { id, audience, email } = account.snapshot;
    const status = await this.mfa.status(principal);
    return {
      id,
      audience,
      email,
      permissions: principal.permissions,
      mfa: { enabled: status.enabled, verified: status.verified, setupRequired: audience === 'admin' && status.required && !status.verified },
    };
  }

  /** Signs out every device, including the current one. */
  async changePassword(principal: Principal, current: string, next: string): Promise<void> {
    assertPasswordAllowed(next, await this.settings.get('security.passwordMinLength'));
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

  private async openSession(accountId: string, audience: Audience, now: Date, mfa: boolean): Promise<IssuedSession> {
    const token = this.secrets.refreshToken();
    const session: NewSession = {
      id: this.secrets.uuid(),
      accountId,
      familyId: this.secrets.uuid(),
      refreshTokenHash: this.secrets.hashToken(token),
      expiresAt: new Date(now.getTime() + (await this.sessionLifetimeMs(audience))),
      mfa,
    };
    await this.sessions.create(session);
    return this.issue(session, token, audience);
  }

  private async issue(session: NewSession, refreshToken: string, audience: Audience): Promise<IssuedSession> {
    const access = this.tokens.issue(
      { accountId: session.accountId, sessionId: session.id, audience },
      (await this.settings.get('security.accessTokenMinutes')) * 60,
    );
    return {
      accountId: session.accountId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: session.expiresAt,
    };
  }
}
