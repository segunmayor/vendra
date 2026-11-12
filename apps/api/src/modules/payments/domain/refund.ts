import { DomainError, Money } from '../../../shared-kernel';

/**
 * - pending: recorded, about to be sent to the gateway.
 * - submitted: the gateway accepted it and is returning the money.
 * - succeeded: the gateway says the money went back.
 * - failed: the gateway refused it, or it did not go through. Nothing was returned.
 * - unknown: the gateway could not be reached mid-request, so it may or may not have it.
 *   Staff check the gateway dashboard and record what happened.
 */
export type RefundStatus = 'pending' | 'submitted' | 'succeeded' | 'failed' | 'unknown';

/** What a gateway says about a refund. */
export interface GatewayRefundResult {
  readonly providerRefundId: string;
  readonly outcome: 'succeeded' | 'pending' | 'failed';
  /** The gateway's own word for it, such as "processing", for staff to see. */
  readonly gatewayStatus: string;
}

export interface RefundState {
  readonly id: string;
  readonly paymentId: string;
  readonly amount: Money;
  readonly reason: string;
  readonly requestedBy: string;
  readonly status: RefundStatus;
  readonly providerRefundId: string | null;
  readonly gatewayStatus: string | null;
  readonly failureReason: string | null;
  readonly resolvedBy: string | null;
  readonly createdAt: Date;
  readonly version: number;
}

/** What a status change means for the money held back on the payment. */
export type RefundSettlement = 'none' | 'complete' | 'release';

const OPEN: readonly RefundStatus[] = ['pending', 'submitted', 'unknown'];

export class Refund {
  private constructor(private state: RefundState) {}

  static request(input: { id: string; paymentId: string; amount: Money; reason: string; requestedBy: string; now: Date }): Refund {
    const reason = input.reason.trim();
    if (reason.length < 3) throw new DomainError('refund.reason_required', 'Say why this refund is being made');
    if (reason.length > 500) throw new DomainError('refund.reason_too_long', 'Keep the reason under 500 characters');
    if (!input.amount.isPositive()) throw new DomainError('payment.invalid_refund', 'Refund amount must be positive');
    return new Refund({
      id: input.id,
      paymentId: input.paymentId,
      amount: input.amount,
      reason,
      requestedBy: input.requestedBy,
      status: 'pending',
      providerRefundId: null,
      gatewayStatus: null,
      failureReason: null,
      resolvedBy: null,
      createdAt: input.now,
      version: 0,
    });
  }

  static rehydrate(state: RefundState): Refund {
    return new Refund(state);
  }

  get snapshot(): RefundState {
    return this.state;
  }

  get isOpen(): boolean {
    return OPEN.includes(this.state.status);
  }

  markSaved(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
  }

  /** Applies the gateway's answer. Returns what to do with the money held on the payment. */
  applyGatewayResult(result: GatewayRefundResult): RefundSettlement {
    if (!this.isOpen) return 'none';
    const base = {
      ...this.state,
      providerRefundId: result.providerRefundId || this.state.providerRefundId,
      gatewayStatus: result.gatewayStatus || this.state.gatewayStatus,
    };
    if (result.outcome === 'succeeded') {
      this.state = { ...base, status: 'succeeded' };
      return 'complete';
    }
    if (result.outcome === 'failed') {
      this.state = { ...base, status: 'failed', failureReason: `The gateway reports the refund as ${result.gatewayStatus || 'failed'}` };
      return 'release';
    }
    this.state = { ...base, status: 'submitted' };
    return 'none';
  }

  /** The gateway refused the request outright, so nothing was refunded. */
  rejected(reason: string): RefundSettlement {
    if (this.state.status !== 'pending') throw new DomainError('refund.not_pending', 'This refund was already sent');
    this.state = { ...this.state, status: 'failed', failureReason: reason.slice(0, 300) };
    return 'release';
  }

  /** The request may or may not have reached the gateway. The money stays held until someone checks. */
  uncertain(reason: string): void {
    if (this.state.status !== 'pending') throw new DomainError('refund.not_pending', 'This refund was already sent');
    this.state = { ...this.state, status: 'unknown', failureReason: reason.slice(0, 300) };
  }

  /** Staff record what the gateway dashboard shows for a refund in doubt. */
  resolve(outcome: 'succeeded' | 'failed', staffId: string, note: string): RefundSettlement {
    if (!this.isOpen) {
      throw new DomainError('refund.not_in_doubt', `This refund is already ${this.state.status}`);
    }
    const trimmed = note.trim();
    if (trimmed.length < 3) throw new DomainError('refund.note_required', 'Say what the gateway dashboard shows');
    this.state = {
      ...this.state,
      status: outcome,
      resolvedBy: staffId,
      failureReason: outcome === 'failed' ? trimmed.slice(0, 300) : this.state.failureReason,
      gatewayStatus: `Recorded by staff: ${trimmed.slice(0, 200)}`,
    };
    return outcome === 'succeeded' ? 'complete' : 'release';
  }
}
