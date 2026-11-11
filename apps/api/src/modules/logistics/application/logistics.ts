import { ApplicationError, AuditEntry, Money, Principal } from '../../../shared-kernel';
import { defineZone, DeliveryZoneState, quote, Quote } from '../domain/delivery-zone';

export type { DeliveryZoneState, Quote } from '../domain/delivery-zone';

export interface DeliveryZoneRepository {
  list(): Promise<DeliveryZoneState[]>;
  /**
   * Saves a zone. Must refuse, with a `delivery.state_taken` conflict, a state already in
   * another zone, checked under a lock so two edits cannot both claim it.
   */
  save(zone: DeliveryZoneState, isNew: boolean, audit: AuditEntry): Promise<void>;
}

export interface ZoneInput {
  readonly code: string;
  readonly name: string;
  readonly states: readonly string[];
  readonly rates: readonly { readonly maxWeightGrams: number; readonly priceMinor: string }[];
}

/** Manual-dispatch delivery pricing by zone and weight. A carrier adapter could quote live later. */
export class LogisticsService {
  constructor(
    private readonly zones: DeliveryZoneRepository,
    private readonly ids: { uuid(): string },
  ) {}

  list(): Promise<DeliveryZoneState[]> {
    return this.zones.list();
  }

  async create(actor: Principal, input: ZoneInput): Promise<DeliveryZoneState> {
    const zone = defineZone({ id: this.ids.uuid(), ...this.toState(input) });
    await this.zones.save(zone, true, this.audit(actor, 'logistics.zone_created', zone));
    return zone;
  }

  async update(actor: Principal, id: string, input: ZoneInput): Promise<DeliveryZoneState> {
    const current = (await this.zones.list()).find((zone) => zone.id === id);
    if (!current) throw new ApplicationError('not_found', 'delivery.zone_not_found', 'Delivery zone not found');
    const zone = defineZone({ id, ...this.toState(input) });
    await this.zones.save(zone, false, { ...this.audit(actor, 'logistics.zone_updated', zone), before: this.summary(current) });
    return zone;
  }

  /** What delivery to this state costs for this weight, or why it is not possible. */
  async quote(state: string, weightGrams: number): Promise<Quote> {
    return quote(await this.zones.list(), state, weightGrams);
  }

  private toState(input: ZoneInput) {
    return {
      code: input.code,
      name: input.name,
      states: input.states,
      rates: input.rates.map((rate) => ({ maxWeightGrams: rate.maxWeightGrams, price: Money.of(BigInt(rate.priceMinor), 'NGN') })),
    };
  }

  private summary(zone: DeliveryZoneState) {
    return {
      code: zone.code,
      name: zone.name,
      states: [...zone.states],
      rates: zone.rates.map((rate) => ({ maxWeightGrams: rate.maxWeightGrams, priceMinor: rate.price.minor.toString() })),
    };
  }

  private audit(actor: Principal, action: string, zone: DeliveryZoneState): AuditEntry {
    return { actorId: actor.accountId, action, targetType: 'delivery_zone', targetId: zone.id, after: this.summary(zone) };
  }
}
