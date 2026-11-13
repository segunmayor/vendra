import { ConcurrencyConflict, DomainError, Principal } from '../../../shared-kernel';
import { SellerOrderContext } from '../../orders';
import { Shipment, ShipmentState } from '../domain/shipment';
import { ManualDispatchAdapter } from '../infrastructure/manual-dispatch.adapter';
import { ShipmentRepository } from './ports';
import { ShippingService } from './shipping.service';

const actor: Principal = { accountId: 'staff-1', sessionId: 's', audience: 'admin', permissions: ['shipments.manage'] };
const now = new Date('2026-11-13T09:00:00Z');

const sellerOrder: SellerOrderContext = {
  orderId: 'o1',
  orderNumber: '100001',
  orderStatus: 'placed',
  customerId: 'c1',
  sellerOrderId: 'so1',
  sellerId: 'vendra',
  status: 'pending',
  address: { recipient: 'Ada Obi', phone: '+2348031234567', line1: '12 Allen Avenue', line2: null, city: 'Ikeja', state: 'Lagos' },
  lines: [
    { id: 'l1', productName: 'Kettle', sku: 'K-1', quantity: 2 },
    { id: 'l2', productName: 'Mug', sku: 'M-1', quantity: 1 },
  ],
};

function setup(options: { shippable?: () => void } = {}) {
  const rows = new Map<string, ShipmentState>();
  const audits: unknown[] = [];
  const events: unknown[] = [];
  const snapshot = (shipment: Shipment): ShipmentState => ({
    id: shipment.id,
    sellerOrderId: shipment.sellerOrderId,
    mode: shipment.mode,
    provider: shipment.provider,
    courier: shipment.courier,
    trackingReference: shipment.trackingReference,
    status: shipment.currentStatus,
    items: shipment.items,
    history: [...shipment.history],
    attempts: [...shipment.deliveryAttempts],
    version: shipment.version + 1,
  });
  const repo: ShipmentRepository = {
    findById: async (id) => (rows.has(id) ? Shipment.rehydrate(rows.get(id)!) : null),
    listForSellerOrders: async (ids) => [...rows.values()].filter((row) => ids.includes(row.sellerOrderId)).map(Shipment.rehydrate),
    listByStatus: async (statuses) => [...rows.values()].filter((row) => statuses.includes(row.status)).map(Shipment.rehydrate),
    save: async (shipment, audit) => {
      const saved = rows.get(shipment.id);
      if ((saved?.version ?? 0) !== shipment.version) throw new ConcurrencyConflict('Shipment', shipment.id);
      events.push(...shipment.pullEvents());
      rows.set(shipment.id, snapshot(shipment));
      audits.push(audit);
      shipment.markSaved();
    },
  };
  let delivered = 0;
  let next = 0;
  const orders = {
    sellerOrder: async (id: string) => (id === 'so1' ? sellerOrder : null),
    sellerOrders: async (ids: readonly string[]) => (ids.includes('so1') ? [sellerOrder] : []),
    sellerOrdersOf: async () => [sellerOrder],
    mySellerOrders: async () => [sellerOrder],
    assertShippable: async () => options.shippable?.(),
  };
  const service = new ShippingService(repo, orders, new ManualDispatchAdapter(), { uuid: () => `sh${++next}` }, { now: () => now }, async () => {
    delivered += 1;
  });
  return { service, rows, audits, events, delivered: () => delivered };
}

describe('ShippingService', () => {
  it('sends every item of the seller order with the courier, audits it and delivers the event at once', async () => {
    const world = setup();
    const shipment = await world.service.send(actor, 'so1', { courier: ' GIG Logistics ', trackingReference: 'GIG-123' });
    expect(shipment).toMatchObject({
      status: 'allocated',
      courier: 'GIG Logistics',
      trackingReference: 'GIG-123',
      items: [
        { orderLineId: 'l1', quantity: 2 },
        { orderLineId: 'l2', quantity: 1 },
      ],
      nextStatuses: ['picked_up', 'cancelled'],
      version: 1,
    });
    expect(world.audits).toEqual([expect.objectContaining({ action: 'shipments.sent', actorId: 'staff-1', targetId: shipment.id })]);
    expect(world.events).toEqual([expect.objectContaining({ type: 'ShipmentStatusChanged', payload: { sellerOrderId: 'so1', status: 'allocated' } })]);
    expect(world.delivered()).toBe(1);
  });

  it('issues its own reference when the courier has no tracking number', async () => {
    const shipment = await setup().service.send(actor, 'so1', { courier: 'Our rider, Musa' });
    expect(shipment.trackingReference).toBe('MD-sh1');
  });

  it('refuses items that cannot be sent, and a missing courier', async () => {
    const world = setup({
      shippable: () => {
        throw new DomainError('order.not_shippable', 'This order cannot be sent because it has a stock issue: refund it instead');
      },
    });
    await expect(world.service.send(actor, 'so1', { courier: 'GIG' })).rejects.toThrow('stock issue');
    await expect(setup().service.send(actor, 'so1', { courier: ' ' })).rejects.toThrow('who is delivering');
    await expect(setup().service.send(actor, 'nope', { courier: 'GIG' })).rejects.toThrow('Order not found');
    expect(world.rows.size).toBe(0);
  });

  it('follows the delivery step by step, recording attempts, and ignores a repeated press', async () => {
    const world = setup();
    const { id } = await world.service.send(actor, 'so1', { courier: 'GIG' });
    for (const status of ['picked_up', 'in_transit', 'out_for_delivery'] as const) await world.service.update(actor, id, { status });
    await world.service.update(actor, id, { status: 'delivery_failed', note: 'Nobody home' });
    await world.service.update(actor, id, { status: 'out_for_delivery' });
    const done = await world.service.update(actor, id, { status: 'delivered' });
    const again = await world.service.update(actor, id, { status: 'delivered', version: 1 });
    expect(done.attempts.map((attempt) => [attempt.attemptNumber, attempt.successful, attempt.reason])).toEqual([
      [1, false, 'Nobody home'],
      [2, true, null],
    ]);
    expect(again.version).toBe(done.version);
    expect(done.history.map((change) => change.status)).toEqual(['created', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivery_failed', 'out_for_delivery', 'delivered']);
  });

  it('refuses a change made on top of one the staff member has not seen', async () => {
    const world = setup();
    const { id, version } = await world.service.send(actor, 'so1', { courier: 'GIG' });
    await world.service.update(actor, id, { status: 'picked_up', version });
    await expect(world.service.update(actor, id, { status: 'cancelled', version })).rejects.toThrow('Someone else');
  });

  it('refuses skipping steps and cancelling after collection', async () => {
    const world = setup();
    const { id } = await world.service.send(actor, 'so1', { courier: 'GIG' });
    await expect(world.service.update(actor, id, { status: 'delivered' })).rejects.toThrow('not out for delivery');
    await world.service.update(actor, id, { status: 'picked_up' });
    await expect(world.service.update(actor, id, { status: 'cancelled' })).rejects.toThrow('Cannot move');
  });

  it('lists open shipments with their order, and hides finished ones', async () => {
    const world = setup();
    const { id } = await world.service.send(actor, 'so1', { courier: 'GIG' });
    expect((await world.service.open()).map((entry) => [entry.id, entry.order.orderNumber])).toEqual([[id, '100001']]);
    await world.service.update(actor, id, { status: 'cancelled' });
    expect(await world.service.open()).toEqual([]);
    expect(await world.service.forOrder('o1')).toHaveLength(1);
  });
});
