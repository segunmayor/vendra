import { AggregateRoot, Audience, DomainError } from '../../../shared-kernel';

export type AccountStatus = 'active' | 'suspended';

export interface AccountState {
  readonly id: string;
  readonly audience: Audience;
  readonly email: string;
  readonly passwordHash: string;
  readonly status: AccountStatus;
}

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DomainError('account.invalid_email', 'Enter a valid email address');
  }
  return email;
}

export function assertPasswordAllowed(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new DomainError(
      'account.invalid_password',
      `Passwords must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
}

export class Account extends AggregateRoot {
  private constructor(private state: AccountState) {
    super();
  }

  static register(input: {
    id: string;
    audience: Audience;
    email: string;
    passwordHash: string;
    now: Date;
  }): Account {
    const account = new Account({
      id: input.id,
      audience: input.audience,
      email: normalizeEmail(input.email),
      passwordHash: input.passwordHash,
      status: 'active',
    });
    account.raise({
      type: 'AccountRegistered',
      aggregateId: input.id,
      occurredAt: input.now,
      payload: { audience: input.audience },
    });
    return account;
  }

  static rehydrate(state: AccountState): Account {
    return new Account(state);
  }

  get snapshot(): AccountState {
    return this.state;
  }

  get isActive(): boolean {
    return this.state.status === 'active';
  }

  changePassword(passwordHash: string): void {
    this.state = { ...this.state, passwordHash };
  }

  suspend(now: Date): void {
    if (this.state.status === 'suspended') return;
    this.state = { ...this.state, status: 'suspended' };
    this.raise({
      type: 'AccountSuspended',
      aggregateId: this.state.id,
      occurredAt: now,
      payload: { audience: this.state.audience },
    });
  }
}
