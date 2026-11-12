import { ConcurrencyConflict, Money, Principal } from '../../../shared-kernel';
import { Payment } from '../domain/payment';
import { Refund, RefundState } from '../domain/refund';
import { GatewayService } from './gateways';
import { PaymentProviderPort, ProviderRejected, ProviderUnavailable } from './ports';
import { RefundRepository, RefundService } from './refunds';

const now = new Date('2026-11-12T12:00:00Z');
const ngn = (minor: bigint) => Money.of(minor, 'NGN');
const staff: Principal = { accountId: 's1', sessionId: 'x', audience: 'admin', permissions: ['orders.refund'], mfa: true };

function paidPayment(): Payment {
  const payment = Payment.initiate({ id: 'p1', checkoutId: 'c1', reference: 'VNDREF', provider: 'paystack', gatewayId: 'g1', amount: ngn(10_000n) });
  payment.applyVerification({ outcome: 'succeeded', amount: ngn(10_000n), providerTransactionId: '77' }, now);
  payment.pullEvents();
  return Payment.rehydrate({ ...payment.snapshot, version: 1 });
}

/** An in-memory store with versions, like the database, plus a hook to simulate a concurrent writer. */
function setup(provider: Partial<PaymentProviderPort>) {
  let stored = paidPayment().snapshot;
  const refunds = new Map<string, RefundState>();
  const hooks = { beforeSave: (_attempt: number) => {} };
  let attempt = 0;

  const repo: RefundRepository = {
    find: async (id) => (refunds.has(id) ? Refund.rehydrate(refunds.get(id)!) : null),
    forPayment: async () => [],
    save: async (refund, payment) => {
      hooks.beforeSave(++attempt);
      if (payment.snapshot.version !== stored.version) throw new ConcurrencyConflict('Payment', payment.snapshot.id);
      const existing = refunds.get(refund.snapshot.id);
      if ((existing?.version ?? 0) !== refund.snapshot.version) throw new ConcurrencyConflict('Refund', refund.snapshot.id);
      payment.pullEvents();
      stored = { ...payment.snapshot, version: payment.snapshot.version + 1 };
      refunds.set(refund.snapshot.id, { ...refund.snapshot, version: refund.snapshot.version + 1 });
      payment.markSaved();
      refund.markSaved();
    },
  };
  const gateways = { provider: async () => ({ provider }) } as unknown as GatewayService;
  const deliver = jest.fn().mockResolvedValue(undefined);
  const service = new RefundService({ findById: async () => Payment.rehydrate(stored) }, repo, gateways, { uuid: () => 'r1' }, { now: () => now }, deliver);
  return {
    service,
    hooks,
    deliver,
    payment: () => stored,
    /** Another writer changes the payment, as a webhook or a second refund would. */
    bumpPayment: () => (stored = { ...stored, version: stored.version + 1 }),
  };
}

describe('RefundService', () => {
  it('needs a session verified with two-step sign-in', async () => {
    const { service } = setup({});
    await expect(service.request({ ...staff, mfa: false }, 'p1', 100n, 'Damaged')).rejects.toMatchObject({ code: 'auth.mfa_required' });
  });

  it('re-applies the result to a fresh copy when the payment changed meanwhile', async () => {
    const world = setup({ refund: async () => ({ providerRefundId: '9', outcome: 'succeeded', gatewayStatus: 'processed' }) });
    world.hooks.beforeSave = (attempt) => {
      // The first save (recording the refund) goes through; the payment then changes before settling.
      if (attempt === 2) world.bumpPayment();
    };
    const refund = await world.service.request(staff, 'p1', 4_000n, 'Damaged');
    expect(refund.status).toBe('succeeded');
    expect(world.payment().refunded.minor).toBe(4_000n);
    expect(world.payment().refundPending.minor).toBe(0n);
    expect(world.payment().status).toBe('partially_refunded');
    expect(world.deliver).toHaveBeenCalledTimes(1);
  });

  it('releases the held money when the gateway refuses', async () => {
    const world = setup({ refund: async () => { throw new ProviderRejected('Paystack refused the request: no'); } });
    const refund = await world.service.request(staff, 'p1', 4_000n, 'Damaged');
    expect(refund).toMatchObject({ status: 'failed', failureReason: 'Paystack refused the request: no' });
    expect(world.payment().refundPending.minor).toBe(0n);
    expect(world.deliver).not.toHaveBeenCalled();
  });

  it('keeps the money held when the gateway gives no clear answer', async () => {
    const world = setup({ refund: async () => { throw new ProviderUnavailable('Could not reach Paystack'); } });
    const refund = await world.service.request(staff, 'p1', 4_000n, 'Damaged');
    expect(refund.status).toBe('unknown');
    expect(world.payment().refundPending.minor).toBe(4_000n);
  });

  it('asks for a full refund only when nothing was refunded before', async () => {
    const refund = jest.fn().mockResolvedValue({ providerRefundId: '9', outcome: 'pending', gatewayStatus: 'pending' });
    const world = setup({ refund });
    await world.service.request(staff, 'p1', 10_000n, 'Cancelled');
    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ full: true, reference: 'VNDREF', transactionId: '77' }));
  });
});
