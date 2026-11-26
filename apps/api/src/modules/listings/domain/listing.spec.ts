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

describe('Listing discounts', () => {
  const withDiscount = () => Listing.create({ id: 'l', variantId: 'v', sellerId: 's', price: ngn(1_200_000n), compareAt: ngn(1_500_000n) });

  it('keeps a usual price above the selling price', () => {
    expect(withDiscount().snapshot.compareAt?.minor).toBe(1_500_000n);
  });

  it.each([1_200_000n, 1_000_000n])('rejects a usual price of %s, not above the price', (minor) => {
    expect(() => Listing.create({ id: 'l', variantId: 'v', sellerId: 's', price: ngn(1_200_000n), compareAt: ngn(minor) })).toThrow('higher');
  });

  it('keeps the usual price when only the price changes, and checks it still applies', () => {
    const listing = withDiscount();
    listing.changePrice(ngn(1_100_000n), now);
    expect(listing.snapshot.compareAt?.minor).toBe(1_500_000n);
    expect(() => listing.changePrice(ngn(1_600_000n), now)).toThrow('higher');
  });

  it('removes a discount with null, and records it', () => {
    const listing = withDiscount();
    listing.changePrice(ngn(1_200_000n), now, null);
    expect(listing.snapshot.compareAt).toBeNull();
    expect(listing.pullEvents()[0]?.payload).toMatchObject({ compareAtMinor: null });
  });

  it('treats the same price and usual price as no change', () => {
    const listing = withDiscount();
    listing.changePrice(ngn(1_200_000n), now, ngn(1_500_000n));
    expect(listing.pullEvents()).toHaveLength(0);
  });
});
