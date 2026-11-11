import { Money, Principal } from '../../../shared-kernel';
import type { CartPricing, CartService } from '../../cart';
import type { InventoryCommands } from '../../inventory';
import type { LogisticsService } from '../../logistics';
import { CheckoutSession, parseAddress } from '../domain/checkout-session';
import { CheckoutRepository, CheckoutService } from './checkout.service';

const ngn = (minor: bigint) => Money.of(minor, 'NGN');
const now = new Date('2026-11-18T10:00:00Z');
const principal: Principal = { accountId: 'c1', sessionId: 's', audience: 'store', permissions: [] };
const address = { recipient: 'Ada Obi', phone: '08031234567', line1: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos' };

function existing(key: string): CheckoutSession {
  return CheckoutSession.rehydrate({
    ...CheckoutSession.open({
      id: `session-${key}`,
      customerId: 'c1',
      idempotencyKey: key,
      lines: [{ listingId: 'l1', variantId: 'v1', sku: 'S', productName: 'P', options: {}, unitPrice: ngn(100n), quantity: 1, lineTotal: ngn(100n) }],
      address: parseAddress(address),
      delivery: ngn(0n),
      weightGrams: 1,
      expiresAt: new Date(now.getTime() + 600_000),
    }).snapshot,
    version: 1,
  });
}

function setup(open: CheckoutSession[]) {
  const released: string[] = [];
  const updated: string[] = [];
  const reserved: string[] = [];
  const sessions: CheckoutRepository = {
    findById: async () => null,
    findByKey: async () => null, // the first lookup misses: the race
    listOpen: async () => open,
    latest: async () => null,
    insert: async () => undefined,
    update: async (session) => void updated.push(session.snapshot.id),
  };
  const carts = { linesOf: async () => [{ listingId: 'l1', quantity: 1 }] } as unknown as CartService;
  const pricing = {
    price: async () => ({
      lines: [{ listingId: 'l1', variantId: 'v1', sku: 'S', productName: 'P', options: {}, image: null, quantity: 1, unitPrice: ngn(100n), lineTotal: ngn(100n), weightGrams: 1, issue: null, availableQuantity: null, productSlug: 'p' }],
      itemCount: 1,
      subtotal: ngn(100n),
      weightGrams: 1,
      canCheckout: true,
    }),
  } as unknown as CartPricing;
  const logistics = { quote: async () => ({ ok: true, zone: 'Lagos', price: ngn(0n) }) } as unknown as LogisticsService;
  const inventory = {
    reserve: async (id: string) => void reserved.push(id),
    release: async (id: string) => void released.push(id),
  } as unknown as InventoryCommands;
  const service = new CheckoutService(sessions, carts, pricing, logistics, inventory, { uuid: () => 'new-session' }, { now: () => now });
  return { service, released, updated, reserved };
}

describe('CheckoutService.start', () => {
  it('returns a concurrent same-key session it finds, without cancelling it or reserving again', async () => {
    const racer = existing('key-1');
    const { service, released, updated, reserved } = setup([racer]);
    const result = await service.start(principal, 'key-1', address);
    expect(result.snapshot.id).toBe('session-key-1');
    expect(result.statusAt(now)).toBe('awaiting_payment');
    expect({ released, updated, reserved }).toEqual({ released: [], updated: [], reserved: [] });
  });

  it('cancels and releases an older checkout with a different key', async () => {
    const older = existing('old-key');
    const { service, released, updated, reserved } = setup([older]);
    const result = await service.start(principal, 'key-2', address);
    expect(result.snapshot.id).toBe('new-session');
    expect(older.snapshot.status).toBe('cancelled');
    expect({ released, updated, reserved }).toEqual({ released: ['session-old-key'], updated: ['session-old-key'], reserved: ['new-session'] });
  });
});
