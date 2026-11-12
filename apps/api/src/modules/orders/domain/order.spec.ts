import { Money } from '../../../shared-kernel';
import { Order, PlaceOrderInput } from './order';

const ngn = (minor: bigint) => Money.of(minor, 'NGN');
const now = new Date('2026-11-12T12:00:00Z');
let n = 0;
const line = (sellerId: string, sku: string, quantity: number, unit: bigint) => ({
  sellerId,
  listingId: `l-${sku}`,
  variantId: `v-${sku}`,
  sku,
  productName: `Product ${sku}`,
  options: {},
  quantity,
  unitPrice: ngn(unit),
  lineTotal: ngn(unit * BigInt(quantity)),
});
const input = (over: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  id: 'o1',
  number: '100001',
  checkoutId: 'c1',
  paymentId: 'p1',
  customerId: 'u1',
  address: { recipient: 'Ada Obi', phone: '+2348031234567', line1: '12 Allen Avenue', line2: null, city: 'Ikeja', state: 'Lagos' },
  subtotal: ngn(3_000n),
  delivery: ngn(500n),
  total: ngn(3_500n),
  stockIssue: false,
  lines: [line('vendra', 'A', 2, 1_000n), line('vendra', 'B', 1, 1_000n)],
  newId: () => `id${++n}`,
  now,
  ...over,
});

describe('Order', () => {
  it('groups lines by seller, keeping the order they were bought in', () => {
    const order = Order.place(input({ lines: [line('s1', 'A', 1, 1_000n), line('s2', 'B', 1, 1_000n), line('s1', 'C', 1, 1_000n)] }));
    expect(order.snapshot.sellerOrders.map((seller) => [seller.sellerId, seller.lines.map((l) => l.sku)])).toEqual([
      ['s1', ['A', 'C']],
      ['s2', ['B']],
    ]);
    expect(order.snapshot.sellerOrders.every((seller) => seller.status === 'pending')).toBe(true);
    expect(order.itemCount).toBe(3);
  });

  it('is placed, or flagged when stock could not be secured, and says so in its event', () => {
    expect(Order.place(input()).snapshot.status).toBe('placed');
    const flagged = Order.place(input({ stockIssue: true }));
    expect(flagged.snapshot.status).toBe('stock_issue');
    expect(flagged.pullEvents()).toEqual([expect.objectContaining({ type: 'OrderPlaced', payload: expect.objectContaining({ number: '100001', totalMinor: '3500', stockIssue: true }) })]);
  });

  it('refuses totals that do not add up', () => {
    expect(() => Order.place(input({ subtotal: ngn(2_999n), total: ngn(3_499n) }))).toThrow('do not add up');
    expect(() => Order.place(input({ total: ngn(3_000n) }))).toThrow('do not add up');
    expect(() => Order.place(input({ lines: [{ ...line('s', 'A', 2, 1_000n), lineTotal: ngn(1_000n) }], subtotal: ngn(1_000n), total: ngn(1_500n) }))).toThrow('Line total');
  });

  it('needs at least one item', () => {
    expect(() => Order.place(input({ lines: [] }))).toThrow('at least one');
  });
});
