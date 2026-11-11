import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/bootstrap';
import { StaffService } from '../../src/modules/identity';
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions';
import { InventoryCommands } from '../../src/modules/inventory';
import { Principal } from '../../src/shared-kernel';

const prisma = new PrismaClient();
const PASSWORD = 'a-long-enough-password';
let app: INestApplication;
let base: string;
let manager: string;
let warehouseId: string;

interface Reply {
  status: number;
  body: any;
}

async function call(method: string, path: string, options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Reply> {
  const response = await fetch(`${base}/v1/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const ok = (reply: Reply, status = 200) => {
  expect({ status: reply.status, body: reply.body }).toMatchObject({ status });
  return reply.body;
};
const admin = (method: string, path: string, body?: unknown, token = manager) => call(method, `admin/${path}`, { token, body });
const unique = () => randomUUID().slice(0, 8);

async function staffToken(permissions: readonly string[]): Promise<string> {
  const staff = app.get(StaffService);
  const root: Principal = { accountId: randomUUID(), sessionId: randomUUID(), audience: 'admin', permissions: PERMISSIONS };
  const role = await staff.createRole(root, `role_${randomUUID()}`, permissions);
  const email = `staff_${randomUUID()}@example.com`;
  await staff.createStaff(root, email, PASSWORD, [role.id]);
  return (await call('POST', 'admin/auth/login', { body: { email, password: PASSWORD } })).body.accessToken;
}

async function customer(): Promise<string> {
  const reply = await call('POST', 'store/auth/register', { body: { email: `shopper_${randomUUID()}@example.ng`, password: PASSWORD } });
  return ok(reply, 201).accessToken;
}

let categoryId: string;

/** A published, priced, on-sale item with this much stock. */
async function item(options: { stock?: number; priceMinor?: string; weightGrams?: number } = {}) {
  const product = ok(await admin('POST', 'products', { name: `Item ${unique()}`, categoryId, description: 'x', attributes: {} }), 201);
  const variant = ok(await admin('POST', `products/${product.id}/variants`, { sku: `CK-${unique()}`, weightGrams: options.weightGrams ?? 500, options: {} }), 201);
  ok(await admin('POST', `products/${product.id}/publish`));
  const listing = ok(await admin('POST', 'listings', { variantId: variant.id, priceMinor: options.priceMinor ?? '1000000', currency: 'NGN' }), 201);
  ok(await admin('POST', `listings/${listing.id}/activate`));
  if (options.stock) await restock(listing.id, options.stock);
  return { product, variant, listingId: listing.id as string };
}

async function restock(listingId: string, delta: number) {
  return call('POST', 'admin/stock/adjustments', {
    token: manager,
    headers: { 'idempotency-key': randomUUID() },
    body: { listingId, warehouseId, delta, reason: delta > 0 ? 'receipt' : 'damaged' },
  });
}

async function stockOf(listingId: string) {
  const rows = await prisma.stockItem.findMany({ where: { listingId } });
  return { onHand: rows.reduce((s, r) => s + r.onHand, 0), reserved: rows.reduce((s, r) => s + r.reserved, 0) };
}

const cart = {
  get: (auth: { token?: string; guest?: string }) => call('GET', 'store/cart', { token: auth.token, headers: auth.guest ? { 'x-cart-token': auth.guest } : {} }),
  add: (auth: { token?: string; guest?: string }, listingId: string, quantity = 1) =>
    call('POST', 'store/cart/items', { token: auth.token, headers: auth.guest ? { 'x-cart-token': auth.guest } : {}, body: { listingId, quantity } }),
  set: (auth: { token?: string; guest?: string }, listingId: string, quantity: number) =>
    call('PUT', `store/cart/items/${listingId}`, { token: auth.token, headers: auth.guest ? { 'x-cart-token': auth.guest } : {}, body: { quantity } }),
};

const lagos = { recipient: 'Ada Obi', phone: '0803 123 4567', line1: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos' };
const startCheckout = (token: string, key: string = randomUUID(), address: Record<string, unknown> = lagos) =>
  call('POST', 'store/checkout', { token, headers: { 'idempotency-key': key }, body: { address } });

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
  // Zones are global and a state belongs to one zone, so each run starts from none.
  await prisma.deliveryRate.deleteMany();
  await prisma.deliveryZone.deleteMany();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  await prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:' } } });
  manager = await staffToken(['catalogue.manage', 'inventory.manage', 'settings.manage']);
  warehouseId = ok(await admin('POST', 'warehouses', { name: `WH ${unique()}`, address: { line1: '1 Allen Avenue', city: 'Ikeja', state: 'Lagos' } }), 201).id;
  categoryId = ok(await admin('POST', 'categories', { name: `Checkout ${unique()}`, attributes: [] }), 201).id;
  ok(
    await admin('POST', 'delivery-zones', {
      code: 'lagos',
      name: 'Lagos',
      states: ['Lagos'],
      rates: [
        { maxWeightGrams: 2000, priceMinor: '250000' },
        { maxWeightGrams: 10000, priceMinor: '500000' },
      ],
    }),
    201,
  );
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('guest cart', () => {
  it('is created on the first add and returns its token once', async () => {
    const { listingId } = await item({ stock: 5, priceMinor: '1250000' });
    const first = ok(await cart.add({}, listingId, 2));
    expect(first.guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.lines[0]).toMatchObject({ listingId, quantity: 2, unitPrice: { amountMinor: '1250000' }, lineTotal: { amountMinor: '2500000' }, issue: null });
    expect(first.subtotal).toEqual({ amountMinor: '2500000', currency: 'NGN' });
    expect(first.canCheckout).toBe(true);

    const again = ok(await cart.add({ guest: first.guestToken }, listingId, 1));
    expect(again.guestToken).toBeUndefined();
    expect(again.lines[0].quantity).toBe(3);
    expect(ok(await cart.get({})).lines).toEqual([]);
  });

  it('stores only a hash of the guest token', async () => {
    const { listingId } = await item({ stock: 5 });
    const { guestToken } = ok(await cart.add({}, listingId));
    expect(await prisma.cart.count({ where: { guestToken } })).toBe(0);
  });

  it('never shows another guest\'s cart for an unknown or malformed token', async () => {
    const { listingId } = await item({ stock: 5 });
    ok(await cart.add({}, listingId));
    for (const guest of ['A'.repeat(43), 'not-a-token', "'; DROP TABLE cart.carts; --"]) {
      expect(ok(await cart.get({ guest })).lines).toEqual([]);
    }
  });

  it('refuses items that are not for sale', async () => {
    const draft = ok(await admin('POST', 'products', { name: `Draft ${unique()}`, categoryId, description: 'x', attributes: {} }), 201);
    const variant = ok(await admin('POST', `products/${draft.id}/variants`, { sku: `DR-${unique()}`, weightGrams: 100, options: {} }), 201);
    const listing = ok(await admin('POST', 'listings', { variantId: variant.id, priceMinor: '100', currency: 'NGN' }), 201);
    expect((await cart.add({}, listing.id)).body.code).toBe('cart.item_unavailable');
    expect((await cart.add({}, randomUUID())).body.code).toBe('cart.item_unavailable');
  });

  it('refuses more than is in stock, and out-of-stock items', async () => {
    const short = await item({ stock: 2 });
    const reply = await cart.add({}, short.listingId, 3);
    expect(reply).toMatchObject({ status: 409, body: { code: 'cart.insufficient_stock', detail: 'Only 2 available' } });
    const none = await item();
    expect((await cart.add({}, none.listingId)).body.code).toBe('cart.out_of_stock');
  });

  it('caps one item at 10 per order', async () => {
    const { listingId } = await item({ stock: 50 });
    const { guestToken } = ok(await cart.add({}, listingId, 10));
    expect((await cart.add({ guest: guestToken }, listingId, 1)).status).toBe(422);
  });

  it('changes and removes lines, and lowering is allowed even after the item goes off sale', async () => {
    const { listingId } = await item({ stock: 5 });
    const { guestToken } = ok(await cart.add({}, listingId, 4));
    ok(await admin('POST', `listings/${listingId}/deactivate`));
    expect(ok(await cart.set({ guest: guestToken }, listingId, 2)).lines[0].quantity).toBe(2);
    expect((await cart.set({ guest: guestToken }, listingId, 3)).body.code).toBe('cart.item_unavailable');
    expect(ok(await call('DELETE', `store/cart/items/${listingId}`, { headers: { 'x-cart-token': guestToken } })).lines).toEqual([]);
  });
});

describe('cart pricing is live', () => {
  it('shows the current price and flags lines that can no longer be bought', async () => {
    const a = await item({ stock: 5, priceMinor: '1000000' });
    const b = await item({ stock: 5 });
    const token = await customer();
    ok(await cart.add({ token }, a.listingId, 2));
    ok(await cart.add({ token }, b.listingId, 3));

    ok(await call('PUT', `admin/listings/${a.listingId}/price`, { token: manager, body: { priceMinor: '900000', currency: 'NGN' } }));
    await restock(b.listingId, -4);
    const view = ok(await cart.get({ token }));
    expect(view.lines[0]).toMatchObject({ unitPrice: { amountMinor: '900000' }, issue: null });
    expect(view.lines[1]).toMatchObject({ issue: 'insufficient_stock', availableQuantity: 1 });
    expect(view.subtotal.amountMinor).toBe('1800000');
    expect(view.canCheckout).toBe(false);

    ok(await admin('POST', `listings/${a.listingId}/deactivate`));
    expect(ok(await cart.get({ token })).lines[0]).toMatchObject({ issue: 'unavailable', unitPrice: null });
  });
});

describe('signing in keeps the basket', () => {
  it('merges the guest cart into the customer cart, capping quantities, and removes the guest cart', async () => {
    const a = await item({ stock: 20 });
    const b = await item({ stock: 20 });
    const token = await customer();
    ok(await cart.add({ token }, a.listingId, 8));
    const { guestToken } = ok(await cart.add({}, a.listingId, 5));
    ok(await cart.add({ guest: guestToken }, b.listingId, 1));

    const merged = ok(await call('POST', 'store/cart/merge', { token, headers: { 'x-cart-token': guestToken } }));
    expect(merged.capped).toBe(true);
    expect(merged.lines.map((line: { listingId: string; quantity: number }) => [line.listingId, line.quantity])).toEqual([
      [a.listingId, 10],
      [b.listingId, 1],
    ]);
    expect(ok(await cart.get({ guest: guestToken })).lines).toEqual([]);
    // Repeating the merge changes nothing.
    expect(ok(await call('POST', 'store/cart/merge', { token, headers: { 'x-cart-token': guestToken } })).lines).toHaveLength(2);
  });

  it('needs a signed-in customer', async () => {
    expect((await call('POST', 'store/cart/merge', { headers: { 'x-cart-token': 'A'.repeat(43) } })).status).toBe(401);
  });

  it('refuses staff and forged tokens on the store cart', async () => {
    expect((await cart.get({ token: manager })).status).toBe(401);
    expect((await cart.get({ token: 'forged.token.value' })).status).toBe(401);
  });
});

describe('delivery zones', () => {
  it('need settings.manage', async () => {
    const clerk = await staffToken(['catalogue.manage']);
    expect((await admin('GET', 'delivery-zones', undefined, clerk)).status).toBe(403);
  });

  it('refuse a state already in another zone, and invalid zones', async () => {
    const clash = await admin('POST', 'delivery-zones', { code: 'sw', name: 'South West', states: ['Ogun', 'Lagos'], rates: [{ maxWeightGrams: 1000, priceMinor: '1' }] });
    expect(clash).toMatchObject({ status: 409, body: { code: 'delivery.state_taken', detail: 'Lagos already belongs to the Lagos zone' } });
    const bad = await admin('POST', 'delivery-zones', { code: 'x', name: 'Nowhere', states: ['Atlantis'], rates: [{ maxWeightGrams: 1000, priceMinor: '1' }] });
    expect(bad.status).toBe(422);
  });

  it('can be edited, and edits are audited', async () => {
    const zone = ok(await admin('POST', 'delivery-zones', { code: `n${unique()}`.replace(/-/g, ''), name: 'North', states: ['Kano'], rates: [{ maxWeightGrams: 1000, priceMinor: '600000' }] }), 201);
    const updated = ok(await admin('PUT', `delivery-zones/${zone.id}`, { ...zone, states: ['Kano', 'Kaduna'], rates: [{ maxWeightGrams: 3000, priceMinor: '700000' }] }));
    expect(updated.states).toEqual(['Kaduna', 'Kano']);
    expect(await prisma.auditLog.count({ where: { targetId: zone.id, action: { startsWith: 'logistics.zone_' } } })).toBe(2);
  });
});

describe('checkout', () => {
  it('needs a signed-in customer and an Idempotency-Key', async () => {
    expect((await call('POST', 'store/checkout', { body: { address: lagos } })).status).toBe(401);
    const token = await customer();
    expect((await call('POST', 'store/checkout', { token, body: { address: lagos } })).status).toBe(400);
  });

  it('quotes delivery for the basket before reserving anything', async () => {
    const { listingId } = await item({ stock: 5, weightGrams: 900 });
    const token = await customer();
    ok(await cart.add({ token }, listingId, 2));
    expect(ok(await call('POST', 'store/checkout/quote', { token, body: { state: 'Lagos' } }))).toMatchObject({
      subtotal: { amountMinor: '2000000' },
      delivery: { amountMinor: '250000' },
      total: { amountMinor: '2250000' },
      problem: null,
    });
    ok(await cart.add({ token }, listingId, 1));
    expect(ok(await call('POST', 'store/checkout/quote', { token, body: { state: 'Lagos' } })).delivery.amountMinor).toBe('500000');
    expect(ok(await call('POST', 'store/checkout/quote', { token, body: { state: 'Sokoto' } }))).toMatchObject({ delivery: null, problem: 'We do not deliver to Sokoto yet' });
    expect((await stockOf(listingId)).reserved).toBe(0);
  });

  it('refuses an empty basket, a basket needing attention, an unserved state and a bad phone number', async () => {
    const token = await customer();
    expect((await startCheckout(token)).body.code).toBe('checkout.empty_cart');
    const { listingId } = await item({ stock: 3 });
    ok(await cart.add({ token }, listingId, 3));
    expect((await startCheckout(token, randomUUID(), { ...lagos, state: 'Sokoto' })).body).toMatchObject({ code: 'checkout.no_delivery', detail: 'We do not deliver to Sokoto yet' });
    expect((await startCheckout(token, randomUUID(), { ...lagos, phone: '12345' })).body.code).toBe('checkout.invalid_phone');
    await restock(listingId, -1);
    expect((await startCheckout(token)).body.code).toBe('checkout.cart_needs_attention');
    expect((await stockOf(listingId)).reserved).toBe(0);
  });

  it('fixes prices, adds delivery and holds the stock for 15 minutes', async () => {
    const { listingId } = await item({ stock: 5, priceMinor: '1250000', weightGrams: 400 });
    const token = await customer();
    ok(await cart.add({ token }, listingId, 2));
    const before = Date.now();
    const session = ok(await startCheckout(token), 201);
    expect(session).toMatchObject({
      status: 'awaiting_payment',
      subtotal: { amountMinor: '2500000' },
      delivery: { amountMinor: '250000' },
      total: { amountMinor: '2750000' },
      address: { recipient: 'Ada Obi', phone: '+2348031234567', state: 'Lagos', line2: null },
    });
    const minutes = (Date.parse(session.expiresAt) - before) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThan(15.1);
    expect(await stockOf(listingId)).toEqual({ onHand: 5, reserved: 2 });

    // A later price change does not touch what the customer agreed to pay.
    ok(await call('PUT', `admin/listings/${listingId}/price`, { token: manager, body: { priceMinor: '9900000', currency: 'NGN' } }));
    expect(ok(await call('GET', `store/checkout/${session.id}`, { token })).total.amountMinor).toBe('2750000');
  });

  it('returns the same session for a repeated key and reserves once, even when the repeats arrive together', async () => {
    const { listingId } = await item({ stock: 10 });
    const token = await customer();
    ok(await cart.add({ token }, listingId, 2));
    const key = randomUUID();
    const replies = await Promise.all(Array.from({ length: 5 }, () => startCheckout(token, key)));
    const ids = new Set(replies.filter((reply) => reply.status === 201).map((reply) => reply.body.id));
    expect(ids.size).toBe(1);
    expect((await stockOf(listingId)).reserved).toBe(2);
    expect(ok(await startCheckout(token, key), 201).id).toBe([...ids][0]);
  });

  it('never oversells: of 6 customers racing for 3 units, exactly 3 succeed', async () => {
    const { listingId } = await item({ stock: 3 });
    const tokens = await Promise.all(Array.from({ length: 6 }, () => customer()));
    for (const token of tokens) ok(await cart.add({ token }, listingId, 1));
    const replies = await Promise.all(tokens.map((token) => startCheckout(token)));
    expect(replies.filter((reply) => reply.status === 201)).toHaveLength(3);
    expect(replies.filter((reply) => reply.status === 409).every((reply) => reply.body.code === 'stock.insufficient')).toBe(true);
    expect(await stockOf(listingId)).toEqual({ onHand: 3, reserved: 3 });
  });

  it('hides a checkout from other customers', async () => {
    const { listingId } = await item({ stock: 5 });
    const owner = await customer();
    ok(await cart.add({ token: owner }, listingId));
    const session = ok(await startCheckout(owner), 201);
    const stranger = await customer();
    expect((await call('GET', `store/checkout/${session.id}`, { token: stranger })).status).toBe(404);
    expect((await call('POST', `store/checkout/${session.id}/cancel`, { token: stranger })).status).toBe(404);
    expect((await stockOf(listingId)).reserved).toBe(1);
  });

  it('returns stock when cancelled, and cancelling twice is harmless', async () => {
    const { listingId } = await item({ stock: 5 });
    const token = await customer();
    ok(await cart.add({ token }, listingId, 3));
    const session = ok(await startCheckout(token), 201);
    expect(ok(await call('POST', `store/checkout/${session.id}/cancel`, { token })).status).toBe('cancelled');
    expect(ok(await call('POST', `store/checkout/${session.id}/cancel`, { token })).status).toBe('cancelled');
    expect((await stockOf(listingId)).reserved).toBe(0);
  });

  it('replaces an earlier open checkout instead of holding stock twice', async () => {
    const { listingId } = await item({ stock: 5 });
    const token = await customer();
    ok(await cart.add({ token }, listingId, 2));
    const first = ok(await startCheckout(token), 201);
    const second = ok(await startCheckout(token), 201);
    expect(second.id).not.toBe(first.id);
    expect(ok(await call('GET', `store/checkout/${first.id}`, { token })).status).toBe('cancelled');
    expect((await stockOf(listingId)).reserved).toBe(2);
  });

  it('expires by the clock and the sweep returns the stock', async () => {
    const { listingId } = await item({ stock: 4 });
    const token = await customer();
    ok(await cart.add({ token }, listingId, 4));
    const session = ok(await startCheckout(token), 201);
    await prisma.checkoutSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await prisma.stockReservation.updateMany({ where: { checkoutId: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(ok(await call('GET', `store/checkout/${session.id}`, { token })).status).toBe('expired');
    expect(await app.get(InventoryCommands).releaseExpired()).toBeGreaterThanOrEqual(1);
    expect((await stockOf(listingId)).reserved).toBe(0);
    expect(await prisma.stockReservation.findFirst({ where: { checkoutId: session.id } })).toMatchObject({ status: 'expired' });
  });

  it('treats lapsed holds as free at once, and releases them when someone else reserves', async () => {
    const { listingId } = await item({ stock: 1 });
    const first = await customer();
    ok(await cart.add({ token: first }, listingId));
    const session = ok(await startCheckout(first), 201);
    await prisma.stockReservation.updateMany({ where: { checkoutId: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    // The lapsed hold already counts as free: the unit can be added and is shown as available.
    const second = await customer();
    expect(ok(await cart.add({ token: second }, listingId)).lines[0].issue).toBeNull();
    ok(await startCheckout(second), 201);
    expect(await stockOf(listingId)).toEqual({ onHand: 1, reserved: 1 });
    expect(await prisma.stockReservation.findFirst({ where: { checkoutId: session.id } })).toMatchObject({ status: 'expired' });
  });

  it('reserves once per checkout even if inventory is asked again, concurrently or later', async () => {
    const { listingId } = await item({ stock: 10 });
    const inventory = app.get(InventoryCommands);
    const checkoutId = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => inventory.reserve(checkoutId, [{ listingId, quantity: 3 }])));
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect((await inventory.reserve(checkoutId, [{ listingId, quantity: 3 }])).created).toBe(false);
    expect((await stockOf(listingId)).reserved).toBe(3);
    expect(await inventory.release(checkoutId)).toBe(1);
    expect(await inventory.release(checkoutId)).toBe(0);
    expect((await stockOf(listingId)).reserved).toBe(0);
  });

  it('stops staff removing stock that checkouts are holding', async () => {
    const { listingId } = await item({ stock: 3 });
    const token = await customer();
    ok(await cart.add({ token }, listingId, 2));
    ok(await startCheckout(token), 201);
    const reply = await restock(listingId, -2);
    expect(reply).toMatchObject({ status: 422, body: { code: 'stock.insufficient' } });
  });

  it('remembers the last address for next time', async () => {
    const { listingId } = await item({ stock: 3 });
    const token = await customer();
    expect(ok(await call('GET', 'store/checkout/last-address', { token })).address).toBeNull();
    ok(await cart.add({ token }, listingId));
    ok(await startCheckout(token), 201);
    expect(ok(await call('GET', 'store/checkout/last-address', { token })).address).toMatchObject({ city: 'Ikeja', phone: '+2348031234567' });
  });
});
