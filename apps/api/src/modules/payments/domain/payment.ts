import { AggregateRoot, DomainError, Money } from '../../../shared-kernel';

export type PaymentStatus =
  | 'initiated'
  | 'succeeded'
  | 'failed'
  | 'requires_review'
  | 'partially_refunded'
  | 'refunded';

/** What the provider says when asked directly. Webhook bodies never produce this. */
export interface ProviderVerification {
  readonly outcome: 'succeeded' | 'failed' | 'pending';
  readonly amount: Money;
  readonly providerTransactionId: string;
}

export interface PaymentState {
  readonly id: string;
  readonly checkoutId: string;
  readonly reference: string;
  /** The gateway type, such as paystack. */
  readonly provider: string;
  /** The configured gateway it went through. */
  readonly gatewayId: string | null;
  /** Where the customer pays. Reused if they come back to the same gateway. */
  readonly redirectUrl: string | null;
  readonly amount: Money;
  readonly status: PaymentStatus;
  readonly providerTransactionId: string | null;
  /** Money confirmed returned to the customer. */
  readonly refunded: Money;
  /** Money in refunds the gateway has not yet confirmed. */
  readonly refundPending: Money;
  readonly version: number;
}

const SETTLED: readonly PaymentStatus[] = ['succeeded', 'partially_refunded', 'refunded'];

export class Payment extends AggregateRoot {
  private constructor(private state: PaymentState) {
    super();
  }

  static initiate(input: {
    id: string;
    checkoutId: string;
    reference: string;
    provider: string;
    gatewayId?: string | null;
    amount: Money;
  }): Payment {
    if (!input.amount.isPositive()) {
      throw new DomainError('payment.invalid_amount', 'Payment amount must be positive');
    }
    return new Payment({
      ...input,
      gatewayId: input.gatewayId ?? null,
      redirectUrl: null,
      status: 'initiated',
      providerTransactionId: null,
      refunded: Money.zero(input.amount.currency),
      refundPending: Money.zero(input.amount.currency),
      version: 0,
    });
  }

  static rehydrate(state: PaymentState): Payment {
    return new Payment(state);
  }

  /** Called by the repository after a successful commit. */
  markSaved(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
  }

  /** Records the gateway's checkout page once it has created one. */
  attachRedirect(url: string): void {
    if (this.state.status !== 'initiated') throw new DomainError('payment.not_open', 'This payment is no longer open');
    this.state = { ...this.state, redirectUrl: url };
  }

  get snapshot(): PaymentState {
    return this.state;
  }

  applyVerification(result: ProviderVerification, now: Date): void {
    const { status } = this.state;

    if (result.outcome === 'pending' || status === 'requires_review') return;

    if (SETTLED.includes(status)) {
      const sameResult =
        result.outcome === 'succeeded' &&
        result.providerTransactionId === this.state.providerTransactionId &&
        result.amount.equals(this.state.amount);
      if (!sameResult) this.emit('PaymentVerificationConflict', now, result);
      return;
    }

    if (result.outcome === 'failed') {
      if (status === 'failed') return;
      this.state = { ...this.state, status: 'failed' };
      this.emit('PaymentFailed', now, result);
      return;
    }

    // A success after a failure is accepted: the provider confirms money was taken.
    if (!result.amount.equals(this.state.amount)) {
      this.state = {
        ...this.state,
        status: 'requires_review',
        providerTransactionId: result.providerTransactionId,
      };
      this.emit('PaymentFlaggedForReview', now, result);
      return;
    }

    this.state = {
      ...this.state,
      status: 'succeeded',
      providerTransactionId: result.providerTransactionId,
    };
    this.emit('PaymentSucceeded', now, result);
  }

  /** What can still be refunded: paid, less refunds made or in progress. */
  get refundable(): Money {
    return this.state.amount.subtract(this.state.refunded).subtract(this.state.refundPending);
  }

  /**
   * Holds back money for a refund before the gateway is asked, so two refunds at once can
   * never return more than was paid.
   */
  reserveRefund(amount: Money): void {
    if (this.state.status !== 'succeeded' && this.state.status !== 'partially_refunded') {
      throw new DomainError('payment.not_refundable', `Only a successful payment can be refunded. This one is ${this.state.status.replace('_', ' ')}.`);
    }
    if (!amount.isPositive()) throw new DomainError('payment.invalid_refund', 'Refund amount must be positive');
    if (amount.isGreaterThan(this.refundable)) {
      throw new DomainError('payment.refund_exceeds_captured', 'Refunds cannot add up to more than the customer paid');
    }
    this.state = { ...this.state, refundPending: this.state.refundPending.add(amount) };
  }

  /** The gateway confirmed the money went back. */
  completeRefund(refundId: string, amount: Money, now: Date): void {
    this.takeFromPending(amount);
    const refunded = this.state.refunded.add(amount);
    this.state = { ...this.state, refunded, status: refunded.equals(this.state.amount) ? 'refunded' : 'partially_refunded' };
    this.raise({
      type: 'PaymentRefunded',
      aggregateId: this.state.id,
      occurredAt: now,
      payload: { refundId, checkoutId: this.state.checkoutId, amountMinor: amount.minor.toString(), currency: amount.currency },
    });
  }

  /** The refund did not happen, so the money can be refunded again later. */
  releaseRefund(amount: Money): void {
    this.takeFromPending(amount);
  }

  private takeFromPending(amount: Money): void {
    if (amount.isGreaterThan(this.state.refundPending)) {
      throw new DomainError('payment.refund_not_reserved', 'This refund was not reserved on the payment');
    }
    this.state = { ...this.state, refundPending: this.state.refundPending.subtract(amount) };
  }

  private emit(type: string, now: Date, result: ProviderVerification): void {
    this.raise({
      type,
      aggregateId: this.state.id,
      occurredAt: now,
      payload: {
        checkoutId: this.state.checkoutId,
        reference: this.state.reference,
        outcome: result.outcome,
        providerTransactionId: result.providerTransactionId,
        amountMinor: result.amount.minor.toString(),
        currency: result.amount.currency,
      },
    });
  }
}
