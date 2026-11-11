import { Money } from '../../../shared-kernel';
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
  /** Commits state and pulled events atomically. */
  save(shipment: Shipment): Promise<void>;
}
