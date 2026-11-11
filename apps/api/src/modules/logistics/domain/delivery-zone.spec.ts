import { Money } from '../../../shared-kernel';
import { defineZone, quote } from './delivery-zone';

const ngn = (minor: bigint) => Money.of(minor, 'NGN');
const lagos = defineZone({
  id: 'z1',
  code: 'lagos',
  name: 'Lagos',
  states: ['Lagos'],
  rates: [
    { maxWeightGrams: 5000, price: ngn(350000n) },
    { maxWeightGrams: 1000, price: ngn(200000n) },
  ],
});

describe('delivery zones', () => {
  it('sorts bands and picks the smallest that fits', () => {
    expect(lagos.rates.map((rate) => rate.maxWeightGrams)).toEqual([1000, 5000]);
    expect(quote([lagos], 'Lagos', 400)).toEqual({ ok: true, zone: 'Lagos', price: ngn(200000n) });
    expect(quote([lagos], 'Lagos', 1000)).toMatchObject({ price: ngn(200000n) });
    expect(quote([lagos], 'Lagos', 1001)).toMatchObject({ price: ngn(350000n) });
  });

  it('says why it cannot quote', () => {
    expect(quote([lagos], 'Kano', 400)).toEqual({ ok: false, reason: 'no_zone' });
    expect(quote([lagos], 'Lagos', 5001)).toEqual({ ok: false, reason: 'too_heavy' });
  });

  it('charges a weightless parcel at the first band', () => {
    expect(quote([lagos], 'Lagos', 0)).toMatchObject({ ok: true, price: ngn(200000n) });
  });

  it.each([
    ['a bad code', { code: 'Lagos Zone' }, 'lowercase code'],
    ['no states', { states: [] }, 'at least one state'],
    ['an unknown state', { states: ['Lagoss'] }, 'Unknown state: Lagoss'],
    ['a repeated state', { states: ['Lagos', 'Lagos'] }, 'listed twice'],
    ['no bands', { rates: [] }, 'weight bands'],
    ['duplicate bands', { rates: [{ maxWeightGrams: 10, price: ngn(1n) }, { maxWeightGrams: 10, price: ngn(2n) }] }, 'same limit'],
    ['a negative price', { rates: [{ maxWeightGrams: 10, price: ngn(-1n) }] }, 'negative'],
    ['a foreign currency', { rates: [{ maxWeightGrams: 10, price: Money.of(100n, 'USD') }] }, 'naira'],
    ['a fractional weight', { rates: [{ maxWeightGrams: 1.5, price: ngn(1n) }] }, 'whole grams'],
  ])('refuses %s', (_name, change, message) => {
    expect(() => defineZone({ id: 'z', code: 'zone', name: 'Zone', states: ['Lagos'], rates: [{ maxWeightGrams: 10, price: ngn(1n) }], ...change })).toThrow(message);
  });
});
