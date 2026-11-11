import { CarrierBooking, LogisticsProviderPort, TrackingUpdate } from '../application/ports';
import { Shipment } from '../domain/shipment';

/** Staff arrange the rider and update status in the admin portal. */
export class ManualDispatchAdapter implements LogisticsProviderPort {
  readonly name = 'manual_dispatch';

  async quote(): Promise<null> {
    return null;
  }

  async book(shipment: Shipment): Promise<CarrierBooking> {
    return { trackingReference: `MD-${shipment.id}` };
  }

  async track(): Promise<TrackingUpdate | null> {
    return null;
  }
}
