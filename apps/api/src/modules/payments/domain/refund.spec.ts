import { Money } from '../../../shared-kernel';
import { Refund } from './refund';

const now = new Date('2026-11-12T10:00:00Z');
const make = () => Refund.request({ id: 'r1', paymentId: 'p1', amount: Money.of(5_000n, 'NGN'), reason: 'Out of stock', requestedBy: 's1', now });

describe('Refund', () => {
  it('needs a reason and a positive amount', () => {
    expect(() => Refund.request({ id: 'r', paymentId: 'p', amount: Money.of(1n, 'NGN'), reason: ' ', requestedBy: 's', now })).toThrow('why');
    expect(() => Refund.request({ id: 'r', paymentId: 'p', amount: Money.of(0n, 'NGN'), reason: 'Damaged', requestedBy: 's', now })).toThrow('positive');
  });

  it('completes the payment refund when the gateway confirms it', () => {
    const refund = make();
    expect(refund.applyGatewayResult({ providerRefundId: '9', outcome: 'succeeded', gatewayStatus: 'processed' })).toBe('complete');
    expect(refund.snapshot).toMatchObject({ status: 'succeeded', providerRefundId: '9', gatewayStatus: 'processed' });
  });

  it('waits while the gateway is still processing, then settles once', () => {
    const refund = make();
    expect(refund.applyGatewayResult({ providerRefundId: '9', outcome: 'pending', gatewayStatus: 'processing' })).toBe('none');
    expect(refund.snapshot.status).toBe('submitted');
    expect(refund.applyGatewayResult({ providerRefundId: '', outcome: 'failed', gatewayStatus: 'failed' })).toBe('release');
    expect(refund.snapshot).toMatchObject({ status: 'failed', providerRefundId: '9' });
    // A late or repeated answer changes nothing.
    expect(refund.applyGatewayResult({ providerRefundId: '9', outcome: 'succeeded', gatewayStatus: 'processed' })).toBe('none');
    expect(refund.snapshot.status).toBe('failed');
  });

  it('releases the money when the gateway refuses the request', () => {
    const refund = make();
    expect(refund.rejected('Paystack refused the request: Transaction has been fully reversed')).toBe('release');
    expect(refund.snapshot.status).toBe('failed');
  });

  it('keeps the money held when the outcome is unknown, until staff record it', () => {
    const refund = make();
    refund.uncertain('Could not reach Paystack');
    expect(refund.snapshot.status).toBe('unknown');
    expect(() => refund.resolve('succeeded', 's2', '')).toThrow('dashboard');
    expect(refund.resolve('succeeded', 's2', 'Shown as processed on 12 Nov')).toBe('complete');
    expect(refund.snapshot).toMatchObject({ status: 'succeeded', resolvedBy: 's2' });
    expect(() => refund.resolve('failed', 's2', 'again')).toThrow('already succeeded');
  });

  it('cannot be sent twice', () => {
    const refund = make();
    refund.uncertain('timeout');
    expect(() => refund.rejected('no')).toThrow('already sent');
  });
});
