import { Money } from '../../../shared-kernel';
import { CheckoutSession, parseAddress } from './checkout-session';

const ngn = (minor: bigint) => Money.of(minor, 'NGN');
const address = { recipient: 'Ada Obi', phone: '0803 123 4567', line1: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos' };
const line = (unit: bigint, quantity: number) => ({
  listingId: 'l1',
  variantId: 'v1',
  sku: 'SKU-1',
  productName: 'Shirt',
  options: {},
  unitPrice: ngn(unit),
  quantity,
  lineTotal: ngn(unit * BigInt(quantity)),
});
const now = new Date('2026-11-18T10:00:00Z');
const open = (overrides: Partial<Parameters<typeof CheckoutSession.open>[0]> = {}) =>
  CheckoutSession.open({
    id: 's1',
    customerId: 'c1',
    idempotencyKey: 'key-12345',
    lines: [line(1_250_000n, 2)],
    address: parseAddress(address),
    delivery: ngn(250_000n),
    weightGrams: 800,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
    ...overrides,
  });

describe('parseAddress', () => {
  it.each(['0803 123 4567', '08031234567', '+2348031234567', '2348031234567', '0703-123-4567', '09051234567'])('accepts %s', (phone) => {
    expect(parseAddress({ ...address, phone }).phone).toMatch(/^\+234[789][01]\d{8}$/);
  });

  it.each(['0603 123 4567', '0803123456', '12345', '+1 555 123 4567', ''])('refuses the phone %s', (phone) => {
    expect(() => parseAddress({ ...address, phone })).toThrow('Nigerian mobile number');
  });

  it('refuses an unknown state and short fields, and tidies whitespace', () => {
    expect(() => parseAddress({ ...address, state: 'Lagos State' })).toThrow('Choose a state');
    expect(() => parseAddress({ ...address, line1: ' a ' })).toThrow('Street address');
    expect(parseAddress({ ...address, recipient: '  Ada   Obi ', line2: '  ' })).toMatchObject({ recipient: 'Ada Obi', line2: null });
  });
});

describe('CheckoutSession', () => {
  it('totals the lines plus delivery', () => {
    const session = open();
    expect(session.snapshot.subtotal).toEqual(ngn(2_500_000n));
    expect(session.snapshot.total).toEqual(ngn(2_750_000n));
  });

  it('refuses an empty basket and a line whose total does not add up', () => {
    expect(() => open({ lines: [] })).toThrow('empty');
    expect(() => open({ lines: [{ ...line(100n, 2), lineTotal: ngn(150n) }] })).toThrow('does not match');
  });

  it('expires by the clock', () => {
    const session = open();
    expect(session.statusAt(new Date(now.getTime() + 14 * 60_000))).toBe('awaiting_payment');
    expect(session.statusAt(new Date(now.getTime() + 15 * 60_000))).toBe('expired');
  });

  it('cancels once, and treats cancelling an expired session as a no-op', () => {
    const session = open();
    expect(session.cancel(now)).toBe(true);
    expect(session.cancel(now)).toBe(false);
    expect(session.snapshot.status).toBe('cancelled');
    const late = open();
    expect(late.cancel(new Date(now.getTime() + 60 * 60_000))).toBe(false);
  });

  it('cannot cancel a paid session', () => {
    const paid = CheckoutSession.rehydrate({ ...open().snapshot, status: 'paid' });
    expect(() => paid.cancel(now)).toThrow('paid');
  });
});
