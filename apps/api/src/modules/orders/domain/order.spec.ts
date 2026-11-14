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

describe('Order delivery', () => {
  const placed = () => {
    const order = Order.place(input({ lines: [line('s1', 'A', 1, 1_000n), line('s2', 'B', 2, 1_000n)] }));
    order.pullEvents();
    return order;
  };
  const sellers = (order: Order) => order.snapshot.sellerOrders.map((seller) => seller.status);

  it('is fulfilled once every seller order is delivered, and says so once', () => {
    const order = placed();
    const [a, b] = order.snapshot.sellerOrders.map((seller) => seller.id) as [string, string];
    expect(order.applyShipmentStatus(a, 'dispatched', now)).toBe(true);
    expect(order.applyShipmentStatus(a, 'delivered', now)).toBe(true);
    expect(order.snapshot.status).toBe('placed');
    expect(order.pullEvents()).toEqual([]);
    order.applyShipmentStatus(b, 'delivered', now);
    expect(order.snapshot.status).toBe('fulfilled');
    expect(order.pullEvents()).toEqual([expect.objectContaining({ type: 'OrderFulfilled', payload: expect.objectContaining({ paymentId: 'p1', totalMinor: '3500' }) })]);
    expect(order.applyShipmentStatus(b, 'delivered', now)).toBe(false);
    expect(order.pullEvents()).toEqual([]);
  });

  it('ignores late or repeated updates that would move it backwards', () => {
    const order = placed();
    const a = order.snapshot.sellerOrders[0]!.id;
    order.applyShipmentStatus(a, 'delivered', now);
    expect(order.applyShipmentStatus(a, 'dispatched', now)).toBe(false);
    expect(order.applyShipmentStatus(a, 'back_to_pending', now)).toBe(false);
    expect(sellers(order)).toEqual(['delivered', 'pending']);
  });

  it('goes back to waiting when a shipment is cancelled or returned', () => {
    const order = placed();
    const a = order.snapshot.sellerOrders[0]!.id;
    order.applyShipmentStatus(a, 'dispatched', now);
    order.applyShipmentStatus(a, 'back_to_pending', now);
    expect(sellers(order)).toEqual(['pending', 'pending']);
  });

  it('can only be sent when paid with stock secured, and not twice', () => {
    const order = placed();
    const a = order.snapshot.sellerOrders[0]!.id;
    expect(() => order.assertShippable(a)).not.toThrow();
    order.applyShipmentStatus(a, 'dispatched', now);
    expect(() => order.assertShippable(a)).toThrow('already dispatched');
    const flagged = Order.place(input({ stockIssue: true }));
    expect(() => flagged.assertShippable(flagged.snapshot.sellerOrders[0]!.id)).toThrow('stock issue');
  });
});

describe('Order cancellation', () => {
  const twoSellers = () => {
    const order = Order.place(input({ lines: [line('s1', 'A', 1, 1_500n), line('s2', 'B', 1, 1_500n)] }));
    order.pullEvents();
    return order;
  };

  it('cancels every seller order, records who and why, and says whether stock was taken', () => {
    const order = twoSellers();
    expect(order.cannotCancelBecause).toBeNull();
    order.cancel('  Customer asked by phone  ', 'staff1', now);
    expect(order.snapshot.status).toBe('cancelled');
    expect(order.snapshot.sellerOrders.map((seller) => seller.status)).toEqual(['cancelled', 'cancelled']);
    expect(order.snapshot.cancellation).toEqual({ reason: 'Customer asked by phone', by: 'staff1', at: now });
    const [event] = order.pullEvents();
    expect(event).toMatchObject({
      type: 'OrderCancelled',
      payload: { orderId: 'o1', checkoutId: 'c1', paymentId: 'p1', stockTaken: true, sellerOrderIds: order.snapshot.sellerOrders.map((seller) => seller.id) },
    });
  });

  it('can close a stock issue order, which never took stock', () => {
    const order = Order.place(input({ stockIssue: true }));
    order.pullEvents();
    order.cancel('Sold out, refunded', 'staff1', now);
    expect(order.pullEvents()[0]!.payload.stockTaken).toBe(false);
  });

  it('needs a reason', () => {
    expect(() => twoSellers().cancel('  ', 'staff1', now)).toThrow('Say why');
    expect(() => twoSellers().cancel('x'.repeat(301), 'staff1', now)).toThrow('under 300');
  });

  it('refuses once any items are with a courier, delivered, or already cancelled', () => {
    const collected = twoSellers();
    collected.applyShipmentStatus(collected.snapshot.sellerOrders[1]!.id, 'dispatched', now);
    expect(collected.cannotCancelBecause).toMatch(/collected by a courier/);
    expect(() => collected.cancel('Changed mind', 'staff1', now)).toThrow('cannot be cancelled');

    const delivered = Order.place(input());
    delivered.applyShipmentStatus(delivered.snapshot.sellerOrders[0]!.id, 'delivered', now);
    expect(() => delivered.cancel('Changed mind', 'staff1', now)).toThrow('delivered');

    const cancelled = twoSellers();
    cancelled.cancel('Changed mind', 'staff1', now);
    expect(() => cancelled.cancel('Again', 'staff1', now)).toThrow('already cancelled');
  });

  it('ignores shipment updates that arrive after cancellation', () => {
    const order = twoSellers();
    order.cancel('Changed mind', 'staff1', now);
    expect(order.applyShipmentStatus(order.snapshot.sellerOrders[0]!.id, 'back_to_pending', now)).toBe(false);
    expect(order.snapshot.status).toBe('cancelled');
  });
});
