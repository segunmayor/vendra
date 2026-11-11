import { Shipment } from './shipment';

const now = new Date('2026-11-11T10:00:00Z');
const newShipment = (sellerOrderId = 'so1', orderLineId = 'l1') =>
  Shipment.create({
    id: `s-${orderLineId}`,
    sellerOrderId,
    mode: 'vendra_dispatch',
    provider: 'manual_dispatch',
    items: [{ orderLineId, quantity: 1 }],
    now,
  });
const toOutForDelivery = (shipment: Shipment) => {
  for (const status of ['allocated', 'picked_up', 'in_transit', 'out_for_delivery'] as const) {
    shipment.transitionTo(status, now);
  }
};

describe('Shipment', () => {
  it('rejects an empty shipment', () => {
    expect(() =>
      Shipment.create({ id: 's', sellerOrderId: 'so', mode: 'carrier', provider: 'test', items: [], now }),
    ).toThrow('at least one item');
  });

  it('rejects invalid quantities', () => {
    expect(() =>
      Shipment.create({ id: 's', sellerOrderId: 'so', mode: 'carrier', provider: 'test', items: [{ orderLineId: 'l', quantity: 0 }], now }),
    ).toThrow('positive integers');
  });

  it('allows several shipments for one seller order', () => {
    const shipments = [newShipment('so1', 'l1'), newShipment('so1', 'l2')];
    expect(shipments.map((s) => s.sellerOrderId)).toEqual(['so1', 'so1']);
    expect(new Set(shipments.map((s) => s.id)).size).toBe(2);
  });

  it('records full status history through delivery', () => {
    const shipment = newShipment();
    toOutForDelivery(shipment);
    shipment.recordDeliveryAttempt(true, now);
    expect(shipment.history.map((h) => h.status)).toEqual([
      'created', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered',
    ]);
  });

  it('rejects skipping stages', () => {
    expect(() => newShipment().transitionTo('delivered', now)).toThrow('Cannot move');
  });

  it('ignores a repeated status update', () => {
    const shipment = newShipment();
    shipment.transitionTo('allocated', now);
    shipment.pullEvents();
    shipment.transitionTo('allocated', now);
    expect(shipment.history).toHaveLength(2);
    expect(shipment.pullEvents()).toEqual([]);
  });

  it('cannot be cancelled once picked up', () => {
    const shipment = newShipment();
    shipment.transitionTo('allocated', now);
    shipment.transitionTo('picked_up', now);
    expect(() => shipment.transitionTo('cancelled', now)).toThrow('Cannot move');
  });

  it('supports a failed attempt, a retry, then delivery', () => {
    const shipment = newShipment();
    toOutForDelivery(shipment);
    shipment.recordDeliveryAttempt(false, now, 'Customer unavailable');
    shipment.transitionTo('out_for_delivery', now);
    shipment.recordDeliveryAttempt(true, now);
    expect(shipment.currentStatus).toBe('delivered');
    expect(shipment.deliveryAttempts.map((a) => a.attemptNumber)).toEqual([1, 2]);
  });

  it('supports the return path', () => {
    const shipment = newShipment();
    toOutForDelivery(shipment);
    shipment.recordDeliveryAttempt(false, now, 'Refused');
    shipment.transitionTo('returning', now);
    shipment.transitionTo('returned', now);
    expect(shipment.currentStatus).toBe('returned');
  });

  it('requires a reason for a failed attempt', () => {
    const shipment = newShipment();
    toOutForDelivery(shipment);
    expect(() => shipment.recordDeliveryAttempt(false, now)).toThrow('needs a reason');
  });

  it('rejects an attempt when not out for delivery', () => {
    expect(() => newShipment().recordDeliveryAttempt(true, now)).toThrow('not out for delivery');
  });
});
