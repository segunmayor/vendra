import { ApplicationError, ConcurrencyConflict, DomainError, Principal } from '../../../shared-kernel';
import { OrderService, SellerOrderContext } from '../../orders';
import { DeliveryAttempt, Shipment, ShipmentStatus, StatusChange } from '../domain/shipment';
import { LogisticsProviderPort, ShipmentRepository } from './ports';

type Orders = Pick<OrderService, 'sellerOrder' | 'sellerOrders' | 'sellerOrdersOf' | 'mySellerOrders' | 'assertShippable'>;

/** Statuses of a shipment that is still on its way, for the staff deliveries list. */
export const OPEN_STATUSES: readonly ShipmentStatus[] = ['created', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivery_failed', 'returning'];

export interface ShipmentView {
  readonly id: string;
  readonly sellerOrderId: string;
  readonly status: ShipmentStatus;
  readonly provider: string;
  readonly courier: string | null;
  readonly trackingReference: string | null;
  readonly items: readonly { readonly orderLineId: string; readonly quantity: number }[];
  readonly history: readonly StatusChange[];
  readonly attempts: readonly DeliveryAttempt[];
  readonly nextStatuses: readonly ShipmentStatus[];
  readonly version: number;
}

export interface OpenShipmentView extends ShipmentView {
  readonly order: SellerOrderContext;
}

export interface SendInput {
  readonly courier: string;
  /** The courier's own tracking number. Without one, the provider issues a reference. */
  readonly trackingReference?: string;
  readonly note?: string;
}

const notFound = () => new ApplicationError('not_found', 'shipment.not_found', 'Shipment not found');

/**
 * Staff send a seller order's items and record each step until they are delivered. Each step
 * is recorded as `ShipmentStatusChanged`; orders follows those to mark the order delivered,
 * and the ledger then recognises the sale.
 */
export class ShippingService {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly orders: Orders,
    private readonly provider: LogisticsProviderPort,
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
    /** Delivers committed events at once, so the order page is current when staff look. */
    private readonly deliver: () => Promise<void> = async () => undefined,
  ) {}

  /** Packs every item of a seller order into one shipment and hands it to a courier. */
  async send(actor: Principal, sellerOrderId: string, input: SendInput): Promise<ShipmentView> {
    const courier = input.courier.trim();
    if (courier.length < 2) throw new DomainError('shipment.courier_required', 'Say who is delivering these items');
    const order = await this.orders.sellerOrder(sellerOrderId);
    if (!order) throw new ApplicationError('not_found', 'order.not_found', 'Order not found');
    await this.orders.assertShippable(sellerOrderId);

    const now = this.clock.now();
    const shipment = Shipment.create({
      id: this.ids.uuid(),
      sellerOrderId,
      mode: 'vendra_dispatch',
      provider: this.provider.name,
      courier,
      items: order.lines.map((line) => ({ orderLineId: line.id, quantity: line.quantity })),
      now,
    });
    const tracking = input.trackingReference?.trim();
    shipment.assignTracking(tracking || (await this.provider.book(shipment)).trackingReference);
    shipment.transitionTo('allocated', now, input.note?.trim() || null);
    await this.shipments.save(shipment, {
      actorId: actor.accountId,
      action: 'shipments.sent',
      targetType: 'shipment',
      targetId: shipment.id,
      after: { orderNumber: order.orderNumber, sellerOrderId, courier, trackingReference: shipment.trackingReference },
    });
    await this.deliver();
    return view(shipment);
  }

  /**
   * Records the next step. Pressing the same button twice is harmless. `version` is the one the
   * staff member was looking at: if someone else has moved the shipment since, this is refused
   * rather than applied on top of a change they have not seen.
   */
  async update(actor: Principal, shipmentId: string, input: { status: ShipmentStatus; note?: string; version?: number }): Promise<ShipmentView> {
    const shipment = await this.shipments.findById(shipmentId);
    if (!shipment) throw notFound();
    if (shipment.currentStatus === input.status) return view(shipment);
    if (input.version !== undefined && input.version !== shipment.version) {
      throw new ApplicationError('conflict', 'shipment.changed', 'Someone else has just updated this shipment. Reload to see where it is now.');
    }
    const before = shipment.currentStatus;
    const note = input.note?.trim() || null;
    const now = this.clock.now();
    if (input.status === 'delivered' || input.status === 'delivery_failed') {
      shipment.recordDeliveryAttempt(input.status === 'delivered', now, note);
    } else {
      shipment.transitionTo(input.status, now, note);
    }
    try {
      await this.shipments.save(shipment, {
        actorId: actor.accountId,
        action: 'shipments.status_changed',
        targetType: 'shipment',
        targetId: shipment.id,
        before: { status: before },
        after: { status: shipment.currentStatus, ...(note ? { note: note.slice(0, 300) } : {}) },
      });
    } catch (error) {
      if (error instanceof ConcurrencyConflict) {
        throw new ApplicationError('conflict', 'shipment.changed', 'Someone else has just updated this shipment. Reload to see where it is now.');
      }
      throw error;
    }
    await this.deliver();
    return view(shipment);
  }

  /** Staff: every shipment for an order, oldest first. */
  async forOrder(orderId: string): Promise<ShipmentView[]> {
    const sellers = await this.orders.sellerOrdersOf(orderId);
    return (await this.shipments.listForSellerOrders(sellers.map((seller) => seller.sellerOrderId))).map(view);
  }

  /** Customers: shipments for their own order only. */
  async forMyOrder(principal: Principal, orderId: string): Promise<ShipmentView[]> {
    const sellers = await this.orders.mySellerOrders(principal, orderId);
    return (await this.shipments.listForSellerOrders(sellers.map((seller) => seller.sellerOrderId))).map(view);
  }

  /** Staff: shipments still on their way, longest waiting first, with what and where. */
  async open(status?: ShipmentStatus): Promise<OpenShipmentView[]> {
    const shipments = await this.shipments.listByStatus(status ? [status] : OPEN_STATUSES, 200);
    const orders = new Map((await this.orders.sellerOrders(shipments.map((shipment) => shipment.sellerOrderId))).map((order) => [order.sellerOrderId, order]));
    return shipments.flatMap((shipment) => {
      const order = orders.get(shipment.sellerOrderId);
      return order ? [{ ...view(shipment), order }] : [];
    });
  }
}

function view(shipment: Shipment): ShipmentView {
  return {
    id: shipment.id,
    sellerOrderId: shipment.sellerOrderId,
    status: shipment.currentStatus,
    provider: shipment.provider,
    courier: shipment.courier,
    trackingReference: shipment.trackingReference,
    items: shipment.items,
    history: shipment.history,
    attempts: shipment.deliveryAttempts,
    nextStatuses: shipment.nextStatuses,
    version: shipment.version,
  };
}
