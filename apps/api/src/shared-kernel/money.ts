import { DomainError } from './domain-error';

/** An exact amount in minor units (kobo for NGN). Never a float. */
export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: string,
  ) {}

  static of(minor: bigint, currency: string): Money {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new DomainError('money.invalid_currency', `Invalid currency: ${currency}`);
    }
    return new Money(minor, currency);
  }

  static zero(currency: string): Money {
    return Money.of(0n, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  isPositive(): boolean {
    return this.minor > 0n;
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minor > other.minor;
  }

  /** False, rather than an error, when currencies differ. */
  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError(
        'money.currency_mismatch',
        `Cannot combine ${this.currency} with ${other.currency}`,
      );
    }
  }
}
