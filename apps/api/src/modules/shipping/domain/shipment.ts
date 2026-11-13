import { AggregateRoot, DomainError } from '../../../shared-kernel';

export type FulfilmentMode = 'vendra_dispatch' | 'carrier' | 'vendor_managed' | 'supplier_managed';

export type ShipmentStatus =
  | 'created'
  | 'allocated'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'delivery_failed'
  | 'returning'
  | 'returned'
  | 'cancelled';

const TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  created: ['allocated', 'cancelled'],
  allocated: ['picked_up', 'cancelled'],
  picked_up: ['in_transit'],
  in_transit: ['out_for_delivery'],
  out_for_delivery: ['delivered', 'delivery_failed'],
  delivery_failed: ['out_for_delivery', 'returning'],
  returning: ['returned'],
  delivered: [],
  returned: [],
  cancelled: [],
};

export interface ShipmentItem {
  readonly orderLineId: string;
  readonly quantity: number;
}

export interface StatusChange {
  readonly status: ShipmentStatus;
  readonly at: Date;
  readonly note: string | null;
}

export interface DeliveryAttempt {
  readonly attemptNumber: number;
  readonly at: Date;
  readonly successful: boolean;
  readonly reason: string | null;
}

export interface ShipmentState {
  readonly id: string;
  readonly sellerOrderId: string;
  readonly mode: FulfilmentMode;
  readonly provider: string;
  /** Who carries it: a rider's company or a courier, as staff entered it. */
  readonly courier: string | null;
  readonly trackingReference: string | null;
  readonly status: ShipmentStatus;
  readonly items: readonly ShipmentItem[];
  readonly history: readonly StatusChange[];
  readonly attempts: readonly DeliveryAttempt[];
  readonly version: number;
}

export class Shipment extends AggregateRoot {
  private status: ShipmentStatus = 'created';
  private statusHistory: StatusChange[];
  private attempts: DeliveryAttempt[] = [];
  private tracking: string | null = null;
  private savedVersion = 0;

  private constructor(
    readonly id: string,
    readonly sellerOrderId: string,
    readonly mode: FulfilmentMode,
    readonly provider: string,
    readonly courier: string | null,
    readonly items: readonly ShipmentItem[],
    now: Date,
  ) {
    super();
    this.statusHistory = [{ status: 'created', at: now, note: null }];
  }

  static rehydrate(state: ShipmentState): Shipment {
    const shipment = new Shipment(
      state.id,
      state.sellerOrderId,
      state.mode,
      state.provider,
      state.courier,
      state.items,
      new Date(0),
    );
    shipment.status = state.status;
    shipment.statusHistory = [...state.history];
    shipment.attempts = [...state.attempts];
    shipment.tracking = state.trackingReference;
    shipment.savedVersion = state.version;
    return shipment;
  }

  get version(): number {
    return this.savedVersion;
  }

  get trackingReference(): string | null {
    return this.tracking;
  }

  /** Called by the repository after a successful commit. */
  markSaved(): void {
    this.savedVersion += 1;
  }

  assignTracking(reference: string): void {
    if (this.tracking !== null && this.tracking !== reference) {
      throw new DomainError('shipment.tracking_already_assigned', 'Shipment already has a tracking reference');
    }
    this.tracking = reference;
  }

  static create(input: {
    id: string;
    sellerOrderId: string;
    mode: FulfilmentMode;
    provider: string;
    courier?: string | null;
    items: readonly ShipmentItem[];
    now: Date;
  }): Shipment {
    if (input.items.length === 0) {
      throw new DomainError('shipment.no_items', 'A shipment needs at least one item');
    }
    if (input.items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) {
      throw new DomainError('shipment.invalid_quantity', 'Item quantities must be positive integers');
    }
    const courier = input.courier?.trim() || null;
    return new Shipment(input.id, input.sellerOrderId, input.mode, input.provider, courier, [...input.items], input.now);
  }

  /** Where it can go next, for the staff screen. */
  get nextStatuses(): readonly ShipmentStatus[] {
    return TRANSITIONS[this.status];
  }

  get currentStatus(): ShipmentStatus {
    return this.status;
  }

  get history(): readonly StatusChange[] {
    return this.statusHistory;
  }

  get deliveryAttempts(): readonly DeliveryAttempt[] {
    return this.attempts;
  }

  /** Carriers resend updates, so repeating the current status is ignored. */
  transitionTo(next: ShipmentStatus, now: Date, note: string | null = null): void {
    if (next === this.status) return;
    if (!TRANSITIONS[this.status].includes(next)) {
      throw new DomainError(
        'shipment.invalid_transition',
        `Cannot move shipment from ${this.status} to ${next}`,
      );
    }
    this.status = next;
    this.statusHistory.push({ status: next, at: now, note });
    this.raise({
      type: 'ShipmentStatusChanged',
      aggregateId: this.id,
      occurredAt: now,
      payload: { sellerOrderId: this.sellerOrderId, status: next },
    });
  }

  recordDeliveryAttempt(successful: boolean, now: Date, reason: string | null = null): void {
    if (this.status !== 'out_for_delivery') {
      throw new DomainError('shipment.not_out_for_delivery', 'Shipment is not out for delivery');
    }
    if (!successful && !reason) {
      throw new DomainError('shipment.reason_required', 'A failed attempt needs a reason');
    }
    this.attempts.push({ attemptNumber: this.attempts.length + 1, at: now, successful, reason });
    this.transitionTo(successful ? 'delivered' : 'delivery_failed', now, reason);
  }
}
