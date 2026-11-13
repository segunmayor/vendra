import { AuditEntry, Money } from '../../../shared-kernel';
import { Shipment, ShipmentStatus } from '../domain/shipment';

export interface QuoteRequest {
  readonly destinationZoneCode: string;
  readonly weightGrams: number;
}

export interface CarrierBooking {
  readonly trackingReference: string;
}

export interface TrackingUpdate {
  readonly status: ShipmentStatus;
  readonly at: Date;
}

export interface LogisticsProviderPort {
  readonly name: string;
  /** Null means the provider has no live price, so zone rates apply. */
  quote(request: QuoteRequest): Promise<Money | null>;
  book(shipment: Shipment): Promise<CarrierBooking>;
  /** Null means the provider has no tracking feed, so staff update status. */
  track(trackingReference: string): Promise<TrackingUpdate | null>;
}

export interface ShipmentRepository {
  findById(id: string): Promise<Shipment | null>;
  /** Oldest first. */
  listForSellerOrders(sellerOrderIds: readonly string[]): Promise<Shipment[]>;
  /** Least recently changed first, so what has waited longest comes first. */
  listByStatus(statuses: readonly ShipmentStatus[], limit: number): Promise<Shipment[]>;
  /**
   * Commits state, pulled events and the audit entry atomically. Throws ConcurrencyConflict on
   * a stale version, and a conflict ApplicationError when the seller order already has an
   * open shipment or the courier's tracking number is taken.
   */
  save(shipment: Shipment, audit?: AuditEntry): Promise<void>;
}
