import { DomainError, isNigerianState, Money } from '../../../shared-kernel';

export interface RateTier {
  /** This price applies to parcels up to and including this weight. */
  readonly maxWeightGrams: number;
  readonly price: Money;
}

export interface DeliveryZoneState {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly states: readonly string[];
  readonly rates: readonly RateTier[];
}

const CODE = /^[a-z][a-z0-9_]{1,31}$/;
const MAX_TIERS = 10;
const MAX_WEIGHT = 1_000_000;

const invalid = (message: string) => new DomainError('delivery.invalid_zone', message);

/** Checks and normalises a zone. Tiers are sorted by weight. */
export function defineZone(input: DeliveryZoneState): DeliveryZoneState {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!CODE.test(code)) throw invalid('Use a short lowercase code, such as "lagos" or "south_west"');
  if (name.length < 2 || name.length > 80) throw invalid('Zone names are 2 to 80 characters');
  if (input.states.length === 0) throw invalid('Choose at least one state');
  const unknown = input.states.filter((state) => !isNigerianState(state));
  if (unknown.length > 0) throw invalid(`Unknown state: ${unknown.join(', ')}`);
  if (new Set(input.states).size !== input.states.length) throw invalid('A state is listed twice');
  if (input.rates.length === 0 || input.rates.length > MAX_TIERS) throw invalid(`Give 1 to ${MAX_TIERS} weight bands`);
  const rates = [...input.rates].sort((a, b) => a.maxWeightGrams - b.maxWeightGrams);
  for (const [index, rate] of rates.entries()) {
    if (!Number.isInteger(rate.maxWeightGrams) || rate.maxWeightGrams < 1 || rate.maxWeightGrams > MAX_WEIGHT) {
      throw invalid('Weight bands are whole grams between 1 and 1,000,000');
    }
    if (index > 0 && rates[index - 1]!.maxWeightGrams === rate.maxWeightGrams) throw invalid('Two weight bands have the same limit');
    if (rate.price.minor < 0n) throw invalid('Delivery prices cannot be negative');
    if (rate.price.currency !== 'NGN') throw invalid('Delivery prices are in naira');
  }
  return { ...input, code, name, states: [...input.states].sort(), rates };
}

export type Quote = { readonly ok: true; readonly zone: string; readonly price: Money } | { readonly ok: false; readonly reason: 'no_zone' | 'too_heavy' };

/** The cheapest band that fits the parcel. */
export function quote(zones: readonly DeliveryZoneState[], state: string, weightGrams: number): Quote {
  const zone = zones.find((entry) => entry.states.includes(state));
  if (!zone) return { ok: false, reason: 'no_zone' };
  const tier = zone.rates.find((rate) => rate.maxWeightGrams >= Math.max(1, weightGrams));
  return tier ? { ok: true, zone: zone.name, price: tier.price } : { ok: false, reason: 'too_heavy' };
}
