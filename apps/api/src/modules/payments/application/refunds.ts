import { ApplicationError, AuditEntry, ConcurrencyConflict, Money, Principal } from '../../../shared-kernel';
import { Payment, PaymentStatus } from '../domain/payment';
import { Refund, RefundSettlement, RefundStatus } from '../domain/refund';
import { GatewayService } from './gateways';
import { Clock, PaymentProviderPort, ProviderRejected, ProviderUnavailable } from './ports';

export interface RefundRepository {
  find(id: string): Promise<Refund | null>;
  forPayment(paymentId: string): Promise<Refund[]>;
  /** Saves the refund and the payment together. Rejects a stale version of either. */
  save(refund: Refund, payment: Payment, audit?: AuditEntry): Promise<void>;
}

export interface PaymentLookup {
  findById(id: string): Promise<Payment | null>;
}

export interface RefundView {
  readonly id: string;
  readonly paymentId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly reason: string;
  readonly requestedBy: string;
  readonly status: RefundStatus;
  readonly providerRefundId: string | null;
  readonly gatewayStatus: string | null;
  readonly failureReason: string | null;
  readonly resolvedBy: string | null;
  readonly createdAt: Date;
}

export interface PaymentDetail {
  readonly id: string;
  readonly reference: string;
  readonly checkoutId: string;
  readonly provider: string;
  readonly gatewayId: string | null;
  readonly providerTransactionId: string | null;
  readonly status: PaymentStatus;
  readonly amountMinor: bigint;
  readonly refundedMinor: bigint;
  readonly refundPendingMinor: bigint;
  readonly refundableMinor: bigint;
  readonly currency: string;
  readonly refunds: RefundView[];
}

const notFound = (what: 'Payment' | 'Refund') => new ApplicationError('not_found', `${what.toLowerCase()}.not_found`, `${what} not found`);
const ATTEMPTS = 5;
/** A refund still "pending" after this long was interrupted before reaching the gateway. */
const STUCK_MS = 5 * 60_000;

function view(refund: Refund): RefundView {
  const state = refund.snapshot;
  return {
    id: state.id,
    paymentId: state.paymentId,
    amountMinor: state.amount.minor,
    currency: state.amount.currency,
    reason: state.reason,
    requestedBy: state.requestedBy,
    status: state.status,
    providerRefundId: state.providerRefundId,
    gatewayStatus: state.gatewayStatus,
    failureReason: state.failureReason,
    resolvedBy: state.resolvedBy,
    createdAt: state.createdAt,
  };
}

/** Refunds always need a session that passed two-step sign-in, whatever the settings say. */
function requireMfa(actor: Principal): void {
  if (actor.mfa !== true) {
    throw new ApplicationError('forbidden', 'auth.mfa_required', 'Turn on two-step sign-in and sign in with your authenticator code to do this.');
  }
}

/**
 * Staff refunds through the gateway the customer paid with. The amount is held on the payment
 * before the gateway is asked, and only counted as refunded once the gateway confirms it.
 */
export class RefundService {
  constructor(
    private readonly payments: PaymentLookup,
    private readonly refunds: RefundRepository,
    private readonly gateways: GatewayService,
    private readonly ids: { uuid(): string },
    private readonly clock: Clock,
    /** Delivers committed events at once, so the ledger records the refund straight away. */
    private readonly deliverEvents: () => Promise<void>,
  ) {}

  async detail(paymentId: string): Promise<PaymentDetail> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw notFound('Payment');
    const state = payment.snapshot;
    return {
      id: state.id,
      reference: state.reference,
      checkoutId: state.checkoutId,
      provider: state.provider,
      gatewayId: state.gatewayId,
      providerTransactionId: state.providerTransactionId,
      status: state.status,
      amountMinor: state.amount.minor,
      refundedMinor: state.refunded.minor,
      refundPendingMinor: state.refundPending.minor,
      refundableMinor: payment.refundable.minor,
      currency: state.amount.currency,
      refunds: (await this.refunds.forPayment(paymentId)).map(view),
    };
  }

  async request(actor: Principal, paymentId: string, amountMinor: bigint, reason: string): Promise<RefundView> {
    requireMfa(actor);
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw notFound('Payment');
    const state = payment.snapshot;
    const amount = Money.of(amountMinor, state.amount.currency);
    const full = amount.equals(state.amount) && !state.refunded.isPositive() && !state.refundPending.isPositive();
    payment.reserveRefund(amount);
    if (!state.gatewayId || !state.providerTransactionId) {
      throw new ApplicationError('conflict', 'refund.no_gateway', 'This payment has no gateway transaction to refund');
    }
    // Fails here, before anything is recorded, if the gateway has no working credentials.
    const provider = await this.providerFor(state.gatewayId);
    const refund = Refund.request({ id: this.ids.uuid(), paymentId, amount, reason, requestedBy: actor.accountId, now: this.clock.now() });
    await this.refunds.save(refund, payment, {
      actorId: actor.accountId,
      action: 'payments.refund_requested',
      targetType: 'payment',
      targetId: paymentId,
      after: { refundId: refund.snapshot.id, amountMinor: amount.minor.toString(), currency: amount.currency, reason: refund.snapshot.reason },
    });

    let settlement: RefundSettlement = 'none';
    try {
      const result = await provider.refund({
        transactionId: state.providerTransactionId,
        reference: state.reference,
        amount,
        full,
        note: refund.snapshot.reason,
      });
      settlement = refund.applyGatewayResult(result);
    } catch (error) {
      if (error instanceof ProviderRejected) settlement = refund.rejected(error.message);
      else refund.uncertain(error instanceof ProviderUnavailable ? error.message : 'The gateway gave an unexpected answer');
    }
    await this.settle(refund, settlement);
    return view(refund);
  }

  /** Asks the gateway how a submitted refund is going. */
  async check(refundId: string): Promise<RefundView> {
    const refund = await this.refunds.find(refundId);
    if (!refund) throw notFound('Refund');
    const { status, providerRefundId, paymentId } = refund.snapshot;
    if (status !== 'submitted' || !providerRefundId) {
      if (status === 'unknown') {
        throw new ApplicationError('conflict', 'refund.check_dashboard', 'The gateway may not have this refund. Check the gateway dashboard, then record what it shows.');
      }
      return view(refund);
    }
    const payment = await this.payments.findById(paymentId);
    if (!payment?.snapshot.gatewayId) throw notFound('Payment');
    const provider = await this.providerFor(payment.snapshot.gatewayId);
    let result;
    try {
      result = await provider.refundStatus(providerRefundId);
    } catch (error) {
      throw new ApplicationError('unavailable', 'payment.gateway_unavailable', error instanceof ProviderUnavailable ? error.message : 'The payment gateway could not be reached');
    }
    await this.settle(refund, refund.applyGatewayResult(result));
    return view(refund);
  }

  /** For a refund in doubt: staff record what the gateway dashboard shows. */
  async resolve(actor: Principal, refundId: string, outcome: 'succeeded' | 'failed', note: string): Promise<RefundView> {
    requireMfa(actor);
    const refund = await this.refunds.find(refundId);
    if (!refund) throw notFound('Refund');
    if (refund.snapshot.status === 'pending' && this.clock.now().getTime() - refund.snapshot.createdAt.getTime() < STUCK_MS) {
      throw new ApplicationError('conflict', 'refund.in_progress', 'This refund is still being sent to the gateway. Wait a few minutes.');
    }
    const settlement = refund.resolve(outcome, actor.accountId, note);
    await this.settle(refund, settlement, {
      actorId: actor.accountId,
      action: 'payments.refund_resolved',
      targetType: 'refund',
      targetId: refundId,
      after: { outcome, note: note.trim().slice(0, 300) },
    });
    return view(refund);
  }

  /**
   * Saves the refund with what it means for the payment. The payment may be changing at the
   * same moment (another refund, a webhook), so it is reloaded and the change re-applied.
   */
  private async settle(refund: Refund, settlement: RefundSettlement, audit?: AuditEntry): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const payment = await this.payments.findById(refund.snapshot.paymentId);
      if (!payment) throw notFound('Payment');
      if (settlement === 'complete') payment.completeRefund(refund.snapshot.id, refund.snapshot.amount, this.clock.now());
      if (settlement === 'release') payment.releaseRefund(refund.snapshot.amount);
      try {
        await this.refunds.save(refund, payment, audit);
        break;
      } catch (error) {
        const current = error instanceof ConcurrencyConflict ? await this.refunds.find(refund.snapshot.id) : null;
        // Retry only when the payment moved on. If the refund itself changed, someone else
        // already settled it, and their result stands.
        if (!current || current.snapshot.version !== refund.snapshot.version || attempt >= ATTEMPTS) throw error;
      }
    }
    if (settlement === 'complete') await this.deliverEvents();
  }

  private async providerFor(gatewayId: string): Promise<PaymentProviderPort> {
    try {
      return (await this.gateways.provider(gatewayId)).provider;
    } catch (error) {
      if (error instanceof ProviderUnavailable) throw new ApplicationError('unavailable', 'payment.gateway_unavailable', error.message);
      throw error;
    }
  }
}
