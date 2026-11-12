import { ApplicationError, DomainError, Principal } from '../../../shared-kernel';
import { SettingsReader } from '../../settings';
import { AuditTrail, Clock, LoginThrottle, MfaRepository, RecoveryCodeGenerator, Secrets, SecretSealer, TotpPort } from './ports';

const CHALLENGE_MINUTES = 5;
const CHALLENGE_ATTEMPTS = 5;
const RECOVERY_CODES = 10;

export interface MfaStatus {
  /** An authenticator app is set up for this account. */
  readonly enabled: boolean;
  /** This session passed the second step. */
  readonly verified: boolean;
  /** Staff must set it up before using Admin. */
  readonly required: boolean;
  readonly recoveryCodesLeft: number;
}

export interface MfaEnrolment {
  /** For typing into an app by hand. */
  readonly secret: string;
  /** For the QR code. */
  readonly uri: string;
}

export interface MfaChallenge {
  readonly challengeToken: string;
  readonly challengeExpiresAt: Date;
}

const WRONG_CODE = 'That code is not right. Check your authenticator app and try again.';
/** While signing in: the person is not authenticated yet. */
const invalidCode = () => new ApplicationError('unauthenticated', 'auth.mfa_invalid_code', WRONG_CODE);
/** While signed in (setting up, new recovery codes): a wrong code is bad input, not a lost session. */
const wrongCode = () => new DomainError('auth.mfa_invalid_code', WRONG_CODE);
const tooMany = () => new ApplicationError('rate_limited', 'auth.too_many_attempts', 'Too many attempts. Try again later.');
const staffOnly = () => new ApplicationError('forbidden', 'auth.mfa_staff_only', 'Two-step sign-in is for staff accounts');

/** "abcd-efgh-jk" and "ABCDEFGHJK" are the same code. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}


/**
 * Staff two-step sign-in with an authenticator app (TOTP, RFC 6238), and single-use
 * recovery codes for a lost phone.
 */
export class MfaService {
  constructor(
    private readonly mfa: MfaRepository,
    private readonly totp: TotpPort,
    private readonly sealer: SecretSealer,
    private readonly secrets: Secrets,
    private readonly recoveryCodes: RecoveryCodeGenerator,
    private readonly throttle: LoginThrottle,
    private readonly audit: AuditTrail,
    private readonly settings: SettingsReader,
    private readonly clock: Clock,
  ) {}

  /** Whether staff must have a verified second factor to use Admin. */
  async staffRequired(): Promise<boolean> {
    return this.settings.get('security.staffMfaRequired');
  }

  async isEnabled(accountId: string): Promise<boolean> {
    return Boolean((await this.mfa.find(accountId))?.enabledAt);
  }

  async status(principal: Principal): Promise<MfaStatus> {
    if (principal.audience !== 'admin') return { enabled: false, verified: false, required: false, recoveryCodesLeft: 0 };
    const state = await this.mfa.find(principal.accountId);
    const enabled = Boolean(state?.enabledAt);
    return {
      enabled,
      verified: principal.mfa === true,
      required: await this.staffRequired(),
      recoveryCodesLeft: enabled ? await this.mfa.unusedRecoveryCodes(principal.accountId) : 0,
    };
  }

  /** Starts setting up an authenticator app. Starting again replaces an unconfirmed secret. */
  async begin(principal: Principal): Promise<MfaEnrolment> {
    if (principal.audience !== 'admin') throw staffOnly();
    const state = await this.mfa.find(principal.accountId);
    if (!state) throw new ApplicationError('unauthenticated', 'auth.session_invalid', 'Please sign in again');
    const secret = this.totp.newSecret();
    if (state.enabledAt || !(await this.mfa.savePending(principal.accountId, this.sealer.seal(secret)))) {
      throw new ApplicationError('conflict', 'auth.mfa_already_enabled', 'Two-step sign-in is already on for this account');
    }
    const issuer = `${await this.settings.get('store.name')} Admin`;
    return { secret, uri: this.totp.uri(secret, state.email, issuer) };
  }

  /**
   * Turns two-step sign-in on once the person proves the app works. This session becomes
   * verified; every other session ends. Returns recovery codes, shown once and never again.
   */
  async confirm(principal: Principal, code: string): Promise<{ recoveryCodes: string[] }> {
    if (principal.audience !== 'admin') throw staffOnly();
    const state = await this.mfa.find(principal.accountId);
    if (!state?.sealedSecret || state.enabledAt) {
      throw new ApplicationError('conflict', 'auth.mfa_not_pending', state?.enabledAt ? 'Two-step sign-in is already on for this account' : 'Start setting up two-step sign-in first');
    }
    await this.guardAttempts(principal.accountId);
    const step = this.totp.match(this.sealer.open(state.sealedSecret), code.trim(), this.clock.now());
    if (step === null) {
      await this.failed(principal.accountId);
      throw wrongCode();
    }
    const codes = this.newCodes();
    const enabled = await this.mfa.enable(principal.accountId, step, codes.map((code) => this.hashCode(code)), principal.sessionId, this.clock.now(), {
      actorId: principal.accountId,
      action: 'auth.mfa_enabled',
      targetType: 'account',
      targetId: principal.accountId,
    });
    if (!enabled) throw new ApplicationError('conflict', 'auth.mfa_already_enabled', 'Two-step sign-in is already on for this account');
    await this.throttle.clear(this.key(principal.accountId));
    return { recoveryCodes: codes };
  }

  /** New recovery codes replace the old ones. Needs a current code from the app. */
  async regenerateRecoveryCodes(principal: Principal, code: string): Promise<{ recoveryCodes: string[] }> {
    if (principal.audience !== 'admin' || principal.mfa !== true) {
      throw new ApplicationError('forbidden', 'auth.mfa_required', 'Sign in with your authenticator code to do this');
    }
    if (!/^\d{6}$/.test(code.trim()) || !(await this.check(principal.accountId, code))) throw wrongCode();
    const codes = this.newCodes();
    await this.mfa.replaceRecoveryCodes(principal.accountId, codes.map((code) => this.hashCode(code)), {
      actorId: principal.accountId,
      action: 'auth.mfa_recovery_codes_replaced',
      targetType: 'account',
      targetId: principal.accountId,
    });
    return { recoveryCodes: codes };
  }

  /** For a staff member who lost their phone and recovery codes. Ends all their sessions. */
  async reset(actor: Principal, accountId: string): Promise<void> {
    if (actor.accountId === accountId) {
      throw new ApplicationError('forbidden', 'auth.mfa_reset_self', 'Ask another administrator to reset your two-step sign-in');
    }
    const state = await this.mfa.find(accountId);
    if (!state || state.audience !== 'admin') throw new ApplicationError('not_found', 'staff.not_found', 'Staff member not found');
    await this.mfa.reset(accountId, this.clock.now(), {
      actorId: actor.accountId,
      action: 'auth.mfa_reset',
      targetType: 'account',
      targetId: accountId,
    });
  }

  /** After a correct password: a short-lived, single-use ticket for the second step. */
  async openChallenge(accountId: string): Promise<MfaChallenge> {
    const token = this.secrets.refreshToken();
    const expiresAt = new Date(this.clock.now().getTime() + CHALLENGE_MINUTES * 60_000);
    await this.mfa.createChallenge({ id: this.secrets.uuid(), accountId, tokenHash: this.secrets.hashToken(token), expiresAt });
    return { challengeToken: token, challengeExpiresAt: expiresAt };
  }

  /**
   * Completes the second step. Returns the account id, or throws. A challenge allows five
   * wrong codes, then the person must enter their password again.
   */
  async completeChallenge(token: string, code: string): Promise<string> {
    const expired = () => new ApplicationError('unauthenticated', 'auth.mfa_challenge_invalid', 'Your sign-in has expired. Enter your email and password again.');
    const challenge = await this.mfa.findChallenge(this.secrets.hashToken(token));
    const now = this.clock.now();
    if (!challenge || challenge.usedAt || challenge.expiresAt <= now || challenge.attempts >= CHALLENGE_ATTEMPTS) throw expired();

    if (!(await this.check(challenge.accountId, code))) {
      await this.mfa.recordChallengeAttempt(challenge.id);
      await this.audit.record({ actorId: challenge.accountId, action: 'auth.mfa_failed', targetType: 'account', targetId: challenge.accountId });
      throw invalidCode();
    }
    if (!(await this.mfa.consumeChallenge(challenge.id, now))) throw expired();
    return challenge.accountId;
  }

  /** A code from the app, or an unused recovery code. Each works once. */
  private async check(accountId: string, rawCode: string): Promise<boolean> {
    await this.guardAttempts(accountId);
    const code = rawCode.trim();
    const state = await this.mfa.find(accountId);
    if (!state?.enabledAt || !state.sealedSecret) return false;

    let accepted = false;
    if (/^\d{6}$/.test(code)) {
      const step = this.totp.match(this.sealer.open(state.sealedSecret), code, this.clock.now());
      // A code seen once is refused afterwards, even within its 30 seconds.
      accepted = step !== null && (await this.mfa.useStep(accountId, step));
    } else if (normalizeRecoveryCode(code).length === 10) {
      accepted = await this.mfa.useRecoveryCode(accountId, this.hashCode(code), this.clock.now());
      if (accepted) {
        await this.audit.record({ actorId: accountId, action: 'auth.mfa_recovery_code_used', targetType: 'account', targetId: accountId });
      }
    }
    if (accepted) await this.throttle.clear(this.key(accountId));
    else await this.failed(accountId);
    return accepted;
  }

  private newCodes(): string[] {
    return Array.from({ length: RECOVERY_CODES }, () => this.recoveryCodes.next());
  }

  /** The codes are random enough that a fast hash is safe, as for refresh tokens. */
  private hashCode(code: string): string {
    return this.secrets.hashToken(normalizeRecoveryCode(code));
  }

  private key(accountId: string): string {
    return `mfa:${accountId}`;
  }

  private async guardAttempts(accountId: string): Promise<void> {
    const [limit, pauseMinutes] = await this.settings.getMany(['security.failedSignInsPerAccount', 'security.signInPauseMinutes'] as const);
    const since = new Date(this.clock.now().getTime() - pauseMinutes * 60_000);
    if (await this.throttle.isBlocked([{ key: this.key(accountId), limit }], since)) throw tooMany();
  }

  private failed(accountId: string): Promise<void> {
    return this.throttle.recordFailure([this.key(accountId)], this.clock.now());
  }
}
