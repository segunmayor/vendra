import { Money } from '../../../shared-kernel';
import { Payment, ProviderVerification } from './payment';

const now = new Date('2026-11-11T10:00:00Z');
const ngn = (minor: bigint) => Money.of(minor, 'NGN');
const newPayment = () =>
  Payment.initiate({ id: 'p1', checkoutId: 'o1', reference: 'ref1', provider: 'test', amount: ngn(10_000n) });
const result = (over: Partial<ProviderVerification> = {}): ProviderVerification => ({
  outcome: 'succeeded',
  amount: ngn(10_000n),
  providerTransactionId: 'tx1',
  ...over,
});
const types = (payment: Payment) => payment.pullEvents().map((event) => event.type);

describe('Payment', () => {
  it('rejects a non-positive amount', () => {
    expect(() =>
      Payment.initiate({ id: 'p', checkoutId: 'o', reference: 'r', provider: 't', amount: ngn(0n) }),
    ).toThrow('positive');
  });

  it('succeeds on a matching verification', () => {
    const payment = newPayment();
    payment.applyVerification(result(), now);
    expect(payment.snapshot.status).toBe('succeeded');
    expect(types(payment)).toEqual(['PaymentSucceeded']);
  });

  it('is idempotent when the same success is verified twice', () => {
    const payment = newPayment();
    payment.applyVerification(result(), now);
    payment.pullEvents();
    payment.applyVerification(result(), now);
    expect(payment.snapshot.status).toBe('succeeded');
    expect(types(payment)).toEqual([]);
  });

  it.each([
    ['underpayment', ngn(9_999n)],
    ['overpayment', ngn(10_001n)],
    ['wrong currency', Money.of(10_000n, 'USD')],
  ])('flags %s for review and does not succeed', (_name, amount) => {
    const payment = newPayment();
    payment.applyVerification(result({ amount }), now);
    expect(payment.snapshot.status).toBe('requires_review');
    expect(types(payment)).toEqual(['PaymentFlaggedForReview']);
  });

  it('does not auto-resolve a payment under review', () => {
    const payment = newPayment();
    payment.applyVerification(result({ amount: ngn(1n) }), now);
    payment.pullEvents();
    payment.applyVerification(result(), now);
    expect(payment.snapshot.status).toBe('requires_review');
    expect(types(payment)).toEqual([]);
  });

  it('leaves state alone while the provider reports pending', () => {
    const payment = newPayment();
    payment.applyVerification(result({ outcome: 'pending' }), now);
    expect(payment.snapshot.status).toBe('initiated');
    expect(types(payment)).toEqual([]);
  });

  it('honours a late success after a failure', () => {
    const payment = newPayment();
    payment.applyVerification(result({ outcome: 'failed' }), now);
    payment.applyVerification(result(), now);
    expect(payment.snapshot.status).toBe('succeeded');
    expect(types(payment)).toEqual(['PaymentFailed', 'PaymentSucceeded']);
  });

  it('raises a conflict and keeps state when a settled payment is contradicted', () => {
    const payment = newPayment();
    payment.applyVerification(result(), now);
    payment.pullEvents();
    payment.applyVerification(result({ outcome: 'failed' }), now);
    expect(payment.snapshot.status).toBe('succeeded');
    expect(types(payment)).toEqual(['PaymentVerificationConflict']);
  });

  describe('refunds', () => {
    const settled = () => {
      const payment = newPayment();
      payment.applyVerification(result(), now);
      payment.pullEvents();
      return payment;
    };

    it('holds money for a refund, then counts it once the gateway confirms', () => {
      const payment = settled();
      payment.reserveRefund(ngn(4_000n));
      expect(payment.snapshot.status).toBe('succeeded');
      expect(payment.refundable.minor).toBe(6_000n);
      payment.completeRefund('r1', ngn(4_000n), now);
      expect(payment.snapshot.status).toBe('partially_refunded');
      expect(payment.pullEvents()).toEqual([
        expect.objectContaining({ type: 'PaymentRefunded', payload: expect.objectContaining({ refundId: 'r1', amountMinor: '4000' }) }),
      ]);
      payment.reserveRefund(ngn(6_000n));
      payment.completeRefund('r2', ngn(6_000n), now);
      expect(payment.snapshot.status).toBe('refunded');
      expect(payment.refundable.minor).toBe(0n);
    });

    it('counts refunds in progress, so two at once cannot exceed what was paid', () => {
      const payment = settled();
      payment.reserveRefund(ngn(6_000n));
      expect(() => payment.reserveRefund(ngn(4_001n))).toThrow('more than the customer paid');
      payment.reserveRefund(ngn(4_000n));
      expect(payment.refundable.minor).toBe(0n);
    });

    it('frees the money again when a refund fails', () => {
      const payment = settled();
      payment.reserveRefund(ngn(10_000n));
      payment.releaseRefund(ngn(10_000n));
      expect(payment.refundable.minor).toBe(10_000n);
      expect(payment.snapshot.status).toBe('succeeded');
      expect(payment.pullEvents()).toEqual([]);
    });

    it('refuses to settle a refund that was never held', () => {
      expect(() => settled().completeRefund('r', ngn(1n), now)).toThrow('not reserved');
      expect(() => settled().releaseRefund(ngn(1n))).toThrow('not reserved');
    });

    it.each(['initiated', 'requires_review', 'failed'])('rejects refunding a payment that is %s', (status) => {
      const payment = Payment.rehydrate({ ...newPayment().snapshot, status: status as never });
      expect(() => payment.reserveRefund(ngn(1n))).toThrow('Only a successful payment');
    });

    it('rejects a zero refund', () => {
      expect(() => settled().reserveRefund(ngn(0n))).toThrow('positive');
    });
  });
});
