import { Money } from '../../../shared-kernel';
import { Listing } from './listing';

const now = new Date('2026-11-11T10:00:00Z');
const ngn = (minor: bigint) => Money.of(minor, 'NGN');
const make = () => Listing.create({ id: 'l1', variantId: 'v1', sellerId: 's1', price: ngn(1_500_000n) });

describe('Listing', () => {
  it('starts as a draft', () => {
    expect(make().snapshot.status).toBe('draft');
  });

  it.each([0n, -1n])('rejects a price of %s', (minor) => {
    expect(() => Listing.create({ id: 'l', variantId: 'v', sellerId: 's', price: ngn(minor) })).toThrow('more than zero');
    expect(() => make().changePrice(ngn(minor), now)).toThrow('more than zero');
  });

  it('cannot activate until the product is published', () => {
    expect(() => make().activate(false, now)).toThrow('Publish the product');
  });

  it('records price changes with both amounts, and ignores a no-op', () => {
    const listing = make();
    listing.changePrice(ngn(1_500_000n), now);
    listing.changePrice(ngn(1_400_000n), now);
    const events = listing.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ previousMinor: '1500000', priceMinor: '1400000', currency: 'NGN' });
  });

  it('cannot change currency', () => {
    expect(() => make().changePrice(Money.of(1000n, 'USD'), now)).toThrow('currency');
  });

  it('activates and deactivates once each', () => {
    const listing = make();
    listing.activate(true, now);
    listing.activate(true, now);
    listing.deactivate(now);
    listing.deactivate(now);
    expect(listing.pullEvents().map((e) => e.type)).toEqual(['ListingActivated', 'ListingDeactivated']);
  });
});
