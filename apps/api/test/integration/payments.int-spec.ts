import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/bootstrap';
import { StaffService } from '../../src/modules/identity';
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions';
import { OrderService } from '../../src/modules/orders';
import { OutboxRunner } from '../../src/platform/outbox/outbox-runner';
import { Principal } from '../../src/shared-kernel';
import { FakeGateway } from './fake-gateway';
import { verifiedStaffToken } from './staff-mfa';

const prisma = new PrismaClient();
const PASSWORD = 'a-long-enough-password';
const PAYSTACK_KEY = 'sk_test_fake_paystack_key_123456';
const FLW_KEY = 'FLWSECK_TEST-fake-flutterwave-key-1234';
const FLW_HASH = 'a-long-random-webhook-secret-hash';
let app: INestApplication;
let base: string;
let manager: string;
let warehouseId: string;
let categoryId: string;
const fake = new FakeGateway();
/** Gateway transaction ids are unique per gateway, so each run uses fresh ones. */
let nextTx = Date.now();
const txId = () => (nextTx += 1);

interface Reply {
  status: number;
  body: any;
}

async function call(method: string, path: string, options: { token?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  const response = await fetch(`${base}/v1/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...options.headers },
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
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
  return verifiedStaffToken(call, email, PASSWORD);
}

async function customer(): Promise<{ token: string; email: string }> {
  const email = `payer_${randomUUID()}@example.ng`;
  return { token: ok(await call('POST', 'store/auth/register', { body: { email, password: PASSWORD } }), 201).accessToken, email };
}

async function item(stock: number, priceMinor = '1250000') {
  const product = ok(await admin('POST', 'products', { name: `Pay ${unique()}`, categoryId, description: 'x', attributes: {} }), 201);
  const variant = ok(await admin('POST', `products/${product.id}/variants`, { sku: `PY-${unique()}`, weightGrams: 500, options: {} }), 201);
  ok(await admin('POST', `products/${product.id}/publish`));
  const listing = ok(await admin('POST', 'listings', { variantId: variant.id, priceMinor, currency: 'NGN' }), 201);
  ok(await admin('POST', `listings/${listing.id}/activate`));
  if (stock) {
    ok(await call('POST', 'admin/stock/adjustments', { token: manager, headers: { 'idempotency-key': randomUUID() }, body: { listingId: listing.id, warehouseId, delta: stock, reason: 'receipt' } }), 201);
  }
  return listing.id as string;
}

const address = { recipient: 'Ada Obi', phone: '08031234567', line1: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos' };

/** A customer with a checkout of `quantity` units of a fresh item: subtotal 12,500 × q, delivery 2,500. */
async function openCheckout(quantity = 2, stock = 5) {
  const listingId = await item(stock);
  const shopper = await customer();
  ok(await call('POST', 'store/cart/items', { token: shopper.token, body: { listingId, quantity } }));
  const checkout = ok(await call('POST', 'store/checkout', { token: shopper.token, headers: { 'idempotency-key': randomUUID() }, body: { address } }), 201);
  return { ...shopper, listingId, checkout };
}

async function stockOf(listingId: string) {
  const rows = await prisma.stockItem.findMany({ where: { listingId } });
  return { onHand: rows.reduce((s, r) => s + r.onHand, 0), reserved: rows.reduce((s, r) => s + r.reserved, 0) };
}

const gatewayInput = (over: Record<string, unknown> = {}) => ({
  name: 'Paystack',
  enabled: true,
  mode: 'test',
  position: 1,
  config: { apiBaseUrl: `${fake.base}/paystack` },
  credentials: { secretKey: PAYSTACK_KEY },
  ...over,
});

let paystackId: string;
let flutterwaveId: string;

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
  await fake.start();
  fake.acceptedKeys = new Set([PAYSTACK_KEY, FLW_KEY]);
  // Each run starts from defaults and no gateways or zones.
  await prisma.setting.deleteMany();
  await prisma.paymentGateway.deleteMany();
  await prisma.deliveryRate.deleteMany();
  await prisma.deliveryZone.deleteMany();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  await prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:' } } });
  manager = await staffToken(['catalogue.manage', 'inventory.manage', 'settings.manage', 'payments.read']);
  warehouseId = ok(await admin('POST', 'warehouses', { name: `WH ${unique()}`, address: { line1: '1 Allen Avenue', city: 'Ikeja', state: 'Lagos' } }), 201).id;
  categoryId = ok(await admin('POST', 'categories', { name: `Payments ${unique()}`, attributes: [] }), 201).id;
  ok(await admin('POST', 'delivery-zones', { code: 'lagos', name: 'Lagos', states: ['Lagos'], rates: [{ maxWeightGrams: 20000, priceMinor: '250000' }] }), 201);
  await call('PUT', 'admin/settings', { token: manager, body: { values: { 'payments.storefrontUrl': 'https://shop.example.ng', 'payments.apiUrl': 'https://api.example.ng' } } });
  paystackId = ok(await admin('POST', 'payment-gateways', { type: 'paystack', ...gatewayInput() }), 201).id;
  flutterwaveId = ok(
    await admin('POST', 'payment-gateways', {
      type: 'flutterwave',
      ...gatewayInput({ name: 'Flutterwave', position: 2, config: { apiBaseUrl: `${fake.base}/flutterwave` }, credentials: { secretKey: FLW_KEY, webhookHash: FLW_HASH } }),
    }),
    201,
  ).id;
});

afterAll(async () => {
  await prisma.setting.deleteMany();
  await app.close();
  await fake.stop();
  await prisma.$disconnect();
});

describe('settings', () => {
  it('lists every setting in groups, with its default and range', async () => {
    const groups = ok(await admin('GET', 'settings'));
    const hold = groups.flatMap((group: { settings: { key: string }[] }) => group.settings).find((setting: { key: string }) => setting.key === 'shopping.holdMinutes');
    expect(hold).toMatchObject({ kind: 'integer', min: 5, max: 120, defaultValue: 15, value: 15, isDefault: true });
  });

  it('saves all changes or none, and audits them', async () => {
    const bad = await call('PUT', 'admin/settings', { token: manager, body: { values: { 'shopping.holdMinutes': 20, 'store.lowStockThreshold': 999 } } });
    expect(bad).toMatchObject({ status: 422, body: { detail: expect.stringContaining('between 0 and 100') } });
    expect(await prisma.setting.findUnique({ where: { key: 'shopping.holdMinutes' } })).toBeNull();
    expect((await call('PUT', 'admin/settings', { token: manager, body: { values: { 'no.such.setting': 1 } } })).status).toBe(404);
    expect((await call('PUT', 'admin/settings', { token: manager, body: { values: { 'store.name': 'Vendra Lagos' } } })).status).toBe(204);
    expect(await prisma.auditLog.count({ where: { action: 'settings.updated', targetId: 'store.name' } })).toBeGreaterThanOrEqual(1);
  });

  it('needs settings.manage', async () => {
    const clerk = await staffToken(['catalogue.manage']);
    expect((await admin('GET', 'settings', undefined, clerk)).status).toBe(403);
  });

  it('shows only public settings to the storefront', async () => {
    const { values } = ok(await call('GET', 'store/settings'));
    expect(values['store.name']).toBe('Vendra Lagos');
    expect(Object.keys(values).some((key) => key.startsWith('security.') || key.startsWith('payments.'))).toBe(false);
  });

  it('change behaviour at once: the hold time and per-item limit', async () => {
    ok(await call('PUT', 'admin/settings', { token: manager, body: { values: { 'shopping.holdMinutes': 30, 'shopping.maxQuantityPerItem': 3 } } }), 204);
    try {
      const listingId = await item(10);
      const shopper = await customer();
      expect((await call('POST', 'store/cart/items', { token: shopper.token, body: { listingId, quantity: 4 } })).body.detail).toContain('at most 3');
      ok(await call('POST', 'store/cart/items', { token: shopper.token, body: { listingId, quantity: 3 } }));
      const started = Date.now();
      const checkout = ok(await call('POST', 'store/checkout', { token: shopper.token, headers: { 'idempotency-key': randomUUID() }, body: { address } }), 201);
      expect(Math.round((Date.parse(checkout.expiresAt) - started) / 60_000)).toBe(30);
    } finally {
      await prisma.setting.deleteMany({ where: { key: { in: ['shopping.holdMinutes', 'shopping.maxQuantityPerItem'] } } });
    }
  });
});

describe('payment gateways', () => {
  it('never return credentials, only their last four characters', async () => {
    const [gateway] = ok(await admin('GET', 'payment-gateways')).filter((entry: { id: string }) => entry.id === paystackId);
    expect(JSON.stringify(gateway)).not.toContain(PAYSTACK_KEY);
    expect(gateway.credentialHints).toEqual({ secretKey: '••••3456' });
    expect(gateway.webhookUrl).toBe(`https://api.example.ng/v1/webhooks/payments/${paystackId}`);
  });

  it('store credentials encrypted, not as plain text', async () => {
    const row = await prisma.paymentGateway.findUniqueOrThrow({ where: { id: paystackId } });
    expect(row.secrets).toMatch(/^v1:/);
    expect(row.secrets).not.toContain(PAYSTACK_KEY);
  });

  it('refuse a live key in test mode, and turning on without credentials', async () => {
    expect((await admin('POST', 'payment-gateways', { type: 'paystack', ...gatewayInput({ credentials: { secretKey: 'sk_live_abcdefghijk' } }) })).body.detail).toContain('must start with sk_test_');
    expect((await admin('POST', 'payment-gateways', { type: 'paystack', ...gatewayInput({ credentials: {} }) })).body.detail).toContain('before turning this gateway on');
  });

  it('keep saved credentials when the field is left blank on edit', async () => {
    const updated = ok(await admin('PUT', `payment-gateways/${paystackId}`, gatewayInput({ credentials: { secretKey: '' }, name: 'Paystack' })));
    expect(updated.credentialHints.secretKey).toBe('••••3456');
    expect(ok(await admin('POST', `payment-gateways/${paystackId}/test`))).toEqual({ ok: true, message: expect.stringContaining('Connected') });
  });

  it('report a rejected key in plain words', async () => {
    const id = ok(await admin('POST', 'payment-gateways', { type: 'paystack', ...gatewayInput({ enabled: false, name: 'Wrong key', credentials: { secretKey: 'sk_test_wrong_key_000' } }) }), 201).id;
    expect(ok(await admin('POST', `payment-gateways/${id}/test`))).toEqual({ ok: false, message: 'Paystack rejected the credentials' });
  });

  it('show customers only enabled gateways, in the chosen order', async () => {
    const shopper = await customer();
    const options = ok(await call('GET', 'store/payment-options', { token: shopper.token }));
    expect(options.map((option: { name: string }) => option.name)).toEqual(['Paystack', 'Flutterwave']);
  });

  it('need settings.manage to configure', async () => {
    const clerk = await staffToken(['payments.read']);
    expect((await admin('GET', 'payment-gateways', undefined, clerk)).status).toBe(403);
  });
});

describe('paying with Paystack', () => {
  it('sends the exact total in kobo with a return address, and reuses the payment on a repeat', async () => {
    const { token, email, checkout } = await openCheckout(2);
    const before = fake.calls('/paystack/transaction/initialize').length;
    const first = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    const again = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    expect(again).toEqual(first);
    const sent = fake.calls('/paystack/transaction/initialize');
    expect(sent.length - before).toBe(1);
    expect(sent.at(-1)!.body).toEqual({
      email,
      amount: 2750000,
      currency: 'NGN',
      reference: first.reference,
      callback_url: `https://shop.example.ng/checkout/${checkout.id}/return?ref=${first.reference}`,
    });
    expect(sent.at(-1)!.authorization).toBe(`Bearer ${PAYSTACK_KEY}`);
    expect(first.redirectUrl).toBe(`https://checkout.paystack.com/${first.reference}`);
  });

  it('stays pending until the gateway confirms, then completes the checkout once', async () => {
    const { token, listingId, checkout } = await openCheckout(2);
    const { reference } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    expect(ok(await call('POST', `store/payments/${reference}/verify`, { token })).status).toBe('initiated');

    fake.transactions.set(reference, { status: 'success', amount: 2750000, currency: 'NGN', id: txId() });
    expect(ok(await call('POST', `store/payments/${reference}/verify`, { token }))).toEqual({ status: 'succeeded', checkoutId: checkout.id });
    expect(ok(await call('POST', `store/payments/${reference}/verify`, { token })).status).toBe('succeeded');

    expect(ok(await call('GET', `store/checkout/${checkout.id}`, { token })).status).toBe('paid');
    expect(await stockOf(listingId)).toEqual({ onHand: 3, reserved: 0 });
    expect(await prisma.stockMovement.count({ where: { sourceType: 'checkout', sourceId: checkout.id, reason: 'sale' } })).toBe(1);
    expect(ok(await call('GET', 'store/cart', { token })).lines).toEqual([]);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { reference } });
    const entries = await prisma.journalEntry.findMany({ where: { sourceType: 'payment_received', sourceId: payment.id }, include: { lines: true } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.lines.map((line) => [line.accountCode, line.side, line.amountMinor])).toEqual(
      expect.arrayContaining([
        ['1100', 'debit', 2750000n],
        ['2100', 'credit', 2750000n],
      ]),
    );
  });

  it('lets only the payer verify a payment', async () => {
    const { token, checkout } = await openCheckout(1);
    const { reference } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    const stranger = await customer();
    expect((await call('POST', `store/payments/${reference}/verify`, { token: stranger.token })).status).toBe(404);
  });

  it('is safe when the success event is delivered again, even after a crash part-way', async () => {
    const { token, listingId, checkout } = await openCheckout(2, 6);
    const { reference } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    fake.transactions.set(reference, { status: 'success', amount: 2750000, currency: 'NGN', id: txId() });
    ok(await call('POST', `store/payments/${reference}/verify`, { token }));
    expect(await stockOf(listingId)).toEqual({ onHand: 4, reserved: 0 });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { reference } });
    const redeliver = async () => {
      await prisma.outboxEvent.updateMany({ where: { aggregateId: payment.id, type: 'PaymentSucceeded' }, data: { publishedAt: null } });
      await app.get(OutboxRunner).drain();
    };

    // The customer adds the item again after paying; a repeated event must not remove it.
    ok(await call('POST', 'store/cart/items', { token, body: { listingId, quantity: 1 } }));
    await redeliver();
    expect(ok(await call('GET', 'store/cart', { token })).lines.map((line: { quantity: number }) => line.quantity)).toEqual([1]);

    // As if the process died after committing stock but before marking the checkout paid.
    await prisma.checkoutSession.update({ where: { id: checkout.id }, data: { status: 'awaiting_payment' } });
    await redeliver();
    expect(await prisma.checkoutSession.findUniqueOrThrow({ where: { id: checkout.id } })).toMatchObject({ status: 'paid', stockIssue: false });
    expect(await stockOf(listingId)).toEqual({ onHand: 4, reserved: 0 });
    expect(await prisma.journalEntry.count({ where: { sourceId: payment.id } })).toBe(1);
  });

  it('flags a payment of the wrong amount for review and does not complete the checkout', async () => {
    const { token, checkout } = await openCheckout(1);
    const { reference } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    fake.transactions.set(reference, { status: 'success', amount: 100, currency: 'NGN', id: txId() });
    expect(ok(await call('POST', `store/payments/${reference}/verify`, { token })).status).toBe('requires_review');
    expect(ok(await call('GET', `store/checkout/${checkout.id}`, { token })).status).toBe('awaiting_payment');
  });

  it('accepts a correctly signed webhook once, refuses a forged one, and ignores another gateway\'s', async () => {
    const { token, checkout } = await openCheckout(1);
    const { reference } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    fake.transactions.set(reference, { status: 'success', amount: 1500000, currency: 'NGN', id: txId() });
    const raw = JSON.stringify({ event: 'charge.success', data: { id: fake.transactions.get(reference)!.id, reference } });
    const signature = createHmac('sha512', PAYSTACK_KEY).update(raw).digest('hex');

    expect((await call('POST', `webhooks/payments/${paystackId}`, { raw, headers: { 'x-paystack-signature': 'f'.repeat(128) } })).status).toBe(401);
    expect((await call('POST', `webhooks/payments/${paystackId}`, { raw })).status).toBe(401);
    expect(ok(await call('GET', `store/checkout/${checkout.id}`, { token })).status).toBe('awaiting_payment');

    // Signed for Paystack but sent to the Flutterwave address: refused by that gateway's own check.
    expect((await call('POST', `webhooks/payments/${flutterwaveId}`, { raw, headers: { 'x-paystack-signature': signature } })).status).toBe(401);

    ok(await call('POST', `webhooks/payments/${paystackId}`, { raw, headers: { 'x-paystack-signature': signature } }));
    ok(await call('POST', `webhooks/payments/${paystackId}`, { raw, headers: { 'x-paystack-signature': signature } }));
    expect(ok(await call('GET', `store/checkout/${checkout.id}`, { token })).status).toBe('paid');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { reference } });
    expect(await prisma.journalEntry.count({ where: { sourceId: payment.id } })).toBe(1);
  });

  it('honours a payment that arrives after the hold lapsed, re-reserving the stock', async () => {
    const { token, listingId, checkout } = await openCheckout(2, 5);
    const { reference } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    await prisma.stockReservation.updateMany({ where: { checkoutId: checkout.id }, data: { status: 'expired' } });
    await prisma.stockItem.updateMany({ where: { listingId }, data: { reserved: { decrement: 2 } } });
    fake.transactions.set(reference, { status: 'success', amount: 2750000, currency: 'NGN', id: txId() });
    ok(await call('POST', `store/payments/${reference}/verify`, { token }));
    expect(await prisma.checkoutSession.findUniqueOrThrow({ where: { id: checkout.id } })).toMatchObject({ status: 'paid', stockIssue: false });
    expect(await stockOf(listingId)).toEqual({ onHand: 3, reserved: 0 });
  });

  it('still records the payment when the stock sold meanwhile, and flags it for a refund', async () => {
    const { token, listingId, checkout } = await openCheckout(2, 2);
    const { reference } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    await prisma.stockReservation.updateMany({ where: { checkoutId: checkout.id }, data: { status: 'expired' } });
    await prisma.stockItem.updateMany({ where: { listingId }, data: { reserved: { decrement: 2 }, onHand: { decrement: 2 } } });
    fake.transactions.set(reference, { status: 'success', amount: 2750000, currency: 'NGN', id: txId() });
    expect(ok(await call('POST', `store/payments/${reference}/verify`, { token })).status).toBe('succeeded');
    expect(await prisma.checkoutSession.findUniqueOrThrow({ where: { id: checkout.id } })).toMatchObject({ status: 'paid', stockIssue: true });
    // The order is still placed, flagged so staff refund it.
    expect(ok(await call('GET', `store/orders/by-checkout/${checkout.id}`, { token })).status).toBe('stock_issue');
  });

  it('refuses to start payment for an expired checkout, someone else\'s, or a disabled gateway', async () => {
    const { token, checkout } = await openCheckout(1);
    const stranger = await customer();
    expect((await call('POST', `store/checkout/${checkout.id}/payments`, { token: stranger.token, body: { gatewayId: paystackId } })).status).toBe(404);
    expect((await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: randomUUID() } })).body.code).toBe('payment.gateway_not_available');
    await prisma.checkoutSession.update({ where: { id: checkout.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } })).body.code).toBe('checkout.not_payable');
  });

  it('reports an unreachable gateway as unavailable', async () => {
    const { token, checkout } = await openCheckout(1);
    fake.failNext = true;
    const reply = await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } });
    expect(reply).toMatchObject({ status: 503, body: { code: 'payment.gateway_unavailable' } });
  });

  it('lets staff see payments', async () => {
    const list = ok(await admin('GET', 'payments?status=succeeded'));
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((payment: { status: string }) => payment.status === 'succeeded')).toBe(true);
  });
});

describe('paying with Flutterwave', () => {
  it('sends the amount in naira, verifies by reference, and accepts its webhook hash', async () => {
    const { token, checkout } = await openCheckout(2);
    const { reference, redirectUrl } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: flutterwaveId } }), 201);
    expect(redirectUrl).toContain('checkout.flutterwave.com');
    expect(fake.calls('/flutterwave/payments').at(-1)!.body).toMatchObject({ tx_ref: reference, amount: '27500.00', currency: 'NGN' });

    expect(ok(await call('POST', `store/payments/${reference}/verify`, { token })).status).toBe('initiated');
    fake.transactions.set(reference, { status: 'successful', amount: 27500, currency: 'NGN', id: txId() });
    const raw = JSON.stringify({ event: 'charge.completed', data: { id: fake.transactions.get(reference)!.id, tx_ref: reference, status: 'successful' } });
    expect((await call('POST', `webhooks/payments/${flutterwaveId}`, { raw, headers: { 'verif-hash': 'wrong-hash-value-xxxxxxxxxxxxxxx' } })).status).toBe(401);
    ok(await call('POST', `webhooks/payments/${flutterwaveId}`, { raw, headers: { 'verif-hash': FLW_HASH } }));
    expect(ok(await call('GET', `store/checkout/${checkout.id}`, { token })).status).toBe('paid');
  });
});

describe('refunds', () => {
  let refunder: string;

  beforeAll(async () => {
    refunder = await staffToken(['payments.read', 'orders.refund']);
  });

  /** A checkout of 27,500 naira, paid through the given gateway. */
  async function paid(gatewayId = paystackId) {
    const { token, checkout } = await openCheckout(2);
    const { reference } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId } }), 201);
    const amount = gatewayId === paystackId ? 2750000 : 27500;
    fake.transactions.set(reference, { status: gatewayId === paystackId ? 'success' : 'successful', amount, currency: 'NGN', id: txId() });
    expect(ok(await call('POST', `store/payments/${reference}/verify`, { token })).status).toBe('succeeded');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { reference } });
    return { id: payment.id, reference, transactionId: fake.transactions.get(reference)!.id };
  }
  const refund = (paymentId: string, amountMinor: string, token = refunder) =>
    call('POST', `admin/payments/${paymentId}/refunds`, { token, body: { amountMinor, reason: 'Customer returned one item' } });
  const detail = async (paymentId: string) => ok(await call('GET', `admin/payments/${paymentId}`, { token: refunder }));

  it('holds part of a Paystack payment, counts it once the gateway confirms, and records it in the ledger', async () => {
    const payment = await paid();
    const sent = ok(await refund(payment.id, '1000000'), 201);
    expect(sent).toMatchObject({ status: 'submitted', amountMinor: '1000000', gatewayStatus: 'pending' });
    expect(fake.calls('/paystack/refund').at(-1)!.body).toEqual({ transaction: payment.reference, amount: 1000000, currency: 'NGN', merchant_note: 'Customer returned one item' });

    expect(await detail(payment.id)).toMatchObject({ status: 'succeeded', refundedMinor: '0', refundPendingMinor: '1000000', refundableMinor: '1750000' });
    expect(ok(await call('POST', `admin/refunds/${sent.id}/check`, { token: refunder })).status).toBe('submitted');

    fake.refunds.set(Number(sent.providerRefundId), 'processed');
    expect(ok(await call('POST', `admin/refunds/${sent.id}/check`, { token: refunder })).status).toBe('succeeded');
    expect(await detail(payment.id)).toMatchObject({ status: 'partially_refunded', refundedMinor: '1000000', refundPendingMinor: '0', refundableMinor: '1750000' });

    const entries = await prisma.journalEntry.findMany({ where: { sourceType: 'refund_paid', sourceId: sent.id }, include: { lines: true } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.lines.map((line) => [line.accountCode, line.side, line.amountMinor])).toEqual(
      expect.arrayContaining([
        ['2100', 'debit', 1000000n],
        ['1100', 'credit', 1000000n],
      ]),
    );
    // Checking again changes nothing and posts nothing twice.
    ok(await call('POST', `admin/refunds/${sent.id}/check`, { token: refunder }));
    await app.get(OutboxRunner).drain();
    expect(await prisma.journalEntry.count({ where: { sourceType: 'refund_paid', sourceId: sent.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'payments.refund_requested', targetId: payment.id } })).toBe(1);
  });

  it('never returns more than was paid, even when two refunds are sent at once', async () => {
    const payment = await paid();
    const replies = await Promise.all([refund(payment.id, '2000000'), refund(payment.id, '2000000')]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([201, expect.any(Number)]);
    expect([409, 422]).toContain(replies.find((reply) => reply.status !== 201)!.status);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.refundedMinor + row.refundPendingMinor).toBe(2000000n);
    expect((await refund(payment.id, '750001')).status).toBe(422);
    expect(ok(await refund(payment.id, '750000'), 201).status).toBe('submitted');
  });

  it('refunds a whole Flutterwave payment without naming an amount, and completes it at once', async () => {
    const payment = await paid(flutterwaveId);
    const sent = ok(await refund(payment.id, '2750000'), 201);
    expect(sent.status).toBe('succeeded');
    const request = fake.calls(`/flutterwave/transactions/${payment.transactionId}/refund`).at(-1)!;
    expect(request.body).toEqual({ comments: 'Customer returned one item' });
    expect(await detail(payment.id)).toMatchObject({ status: 'refunded', refundedMinor: '2750000', refundableMinor: '0' });
  });

  it('sends part refunds to Flutterwave in whole naira, and refuses kobo', async () => {
    const payment = await paid(flutterwaveId);
    const kobo = ok(await refund(payment.id, '150'), 201);
    expect(kobo).toMatchObject({ status: 'failed', failureReason: expect.stringContaining('whole naira') });
    expect((await detail(payment.id)).refundableMinor).toBe('2750000');
    ok(await refund(payment.id, '500000'), 201);
    expect(fake.calls(`/flutterwave/transactions/${payment.transactionId}/refund`).at(-1)!.body).toEqual({ amount: 5000, comments: 'Customer returned one item' });
  });

  it('frees the money when the gateway refuses', async () => {
    const payment = await paid();
    fake.refundFailure = 'reject';
    const sent = ok(await refund(payment.id, '1000000'), 201);
    expect(sent).toMatchObject({ status: 'failed', failureReason: expect.stringContaining('fully reversed') });
    expect(await detail(payment.id)).toMatchObject({ status: 'succeeded', refundPendingMinor: '0', refundableMinor: '2750000' });
  });

  it('keeps the money held when the outcome is unknown, until staff record what the dashboard shows', async () => {
    const payment = await paid();
    fake.refundFailure = 'drop';
    const sent = ok(await refund(payment.id, '1000000'), 201);
    expect(sent.status).toBe('unknown');
    expect((await detail(payment.id)).refundableMinor).toBe('1750000');
    expect((await call('POST', `admin/refunds/${sent.id}/check`, { token: refunder })).body.code).toBe('refund.check_dashboard');

    const resolve = (outcome: string, note: string) => call('POST', `admin/refunds/${sent.id}/resolve`, { token: refunder, body: { outcome, note } });
    expect((await resolve('failed', '')).status).toBe(422);
    expect(ok(await resolve('failed', 'Not listed on the Paystack dashboard')).status).toBe('failed');
    expect((await detail(payment.id)).refundableMinor).toBe('2750000');
    expect((await resolve('succeeded', 'Changed my mind')).status).toBe(422);
    expect(await prisma.auditLog.count({ where: { action: 'payments.refund_resolved', targetId: sent.id } })).toBe(1);
  });

  it('needs orders.refund and a session verified with two-step sign-in', async () => {
    const payment = await paid();
    const viewer = await staffToken(['payments.read']);
    expect((await refund(payment.id, '100', viewer)).status).toBe(403);

    const staff = app.get(StaffService);
    const root: Principal = { accountId: randomUUID(), sessionId: randomUUID(), audience: 'admin', permissions: PERMISSIONS };
    const role = await staff.createRole(root, `role_${randomUUID()}`, ['payments.read', 'orders.refund']);
    const email = `staff_${randomUUID()}@example.com`;
    await staff.createStaff(root, email, PASSWORD, [role.id]);
    const unverified = (await call('POST', 'admin/auth/login', { body: { email, password: PASSWORD } })).body.accessToken;
    const refused = await refund(payment.id, '100', unverified);
    expect(refused).toMatchObject({ status: 403, body: { code: 'auth.mfa_required' } });
    expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(0);
  });

  it('refuses to refund a payment that has not succeeded', async () => {
    const { token, checkout } = await openCheckout(1);
    const { reference } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { reference } });
    expect((await refund(payment.id, '100')).body).toMatchObject({ status: 422, code: 'payment.not_refundable' });
  });
});

describe('orders', () => {
  let clerk: string;

  beforeAll(async () => {
    clerk = await staffToken(['orders.manage']);
  });

  async function paidOrder() {
    const shopper = await openCheckout(2);
    const { reference } = ok(await call('POST', `store/checkout/${shopper.checkout.id}/payments`, { token: shopper.token, body: { gatewayId: paystackId } }), 201);
    fake.transactions.set(reference, { status: 'success', amount: 2750000, currency: 'NGN', id: txId() });
    ok(await call('POST', `store/payments/${reference}/verify`, { token: shopper.token }));
    return { ...shopper, reference };
  }

  it('places an order from a paid checkout, at the agreed prices, by the time the customer is back', async () => {
    const { token, checkout, listingId, email, reference } = await paidOrder();
    const order = ok(await call('GET', `store/orders/by-checkout/${checkout.id}`, { token }));
    expect(order).toMatchObject({
      status: 'placed',
      number: expect.stringMatching(/^\d{6,}$/),
      subtotal: { amountMinor: '2500000', currency: 'NGN' },
      delivery: { amountMinor: '250000' },
      total: { amountMinor: '2750000' },
      itemCount: 2,
      lineCount: 1,
      address: { recipient: 'Ada Obi', phone: '+2348031234567', city: 'Ikeja', state: 'Lagos' },
    });
    expect(order.sellerOrders).toHaveLength(1);
    expect(order.sellerOrders[0]).toMatchObject({ status: 'pending', lines: [{ listingId, quantity: 2, unitPrice: { amountMinor: '1250000' }, lineTotal: { amountMinor: '2500000' } }] });

    const row = await prisma.payment.findUniqueOrThrow({ where: { reference } });
    const mine = ok(await call('GET', 'store/orders', { token }));
    expect(mine.map((entry: { id: string }) => entry.id)).toEqual([order.id]);
    expect(ok(await call('GET', `store/orders/${order.id}`, { token })).number).toBe(order.number);

    const staffView = ok(await call('GET', `admin/orders/${order.id}`, { token: clerk }));
    expect(staffView).toMatchObject({ paymentId: row.id, checkoutId: checkout.id, customerEmail: email });
    expect(ok(await call('GET', `admin/orders?number=${order.number}`, { token: clerk })).map((entry: { id: string }) => entry.id)).toEqual([order.id]);
    expect(ok(await call('GET', 'admin/orders?status=placed', { token: clerk })).some((entry: { id: string }) => entry.id === order.id)).toBe(true);
    expect(ok(await call('GET', 'admin/orders/counts', { token: clerk })).byStatus.placed).toBeGreaterThanOrEqual(1);
  });

  it('places one order however often the paid event is delivered', async () => {
    const { checkout } = await paidOrder();
    const orders = app.get(OrderService);
    const [a, b] = await Promise.all([orders.placeFromCheckout(checkout.id), orders.placeFromCheckout(checkout.id)]);
    expect(a.snapshot.id).toBe(b.snapshot.id);
    expect(await prisma.order.count({ where: { checkoutId: checkout.id } })).toBe(1);
    await prisma.outboxEvent.updateMany({ where: { type: 'CheckoutPaid', aggregateId: checkout.id }, data: { publishedAt: null, attempts: 0 } });
    await app.get(OutboxRunner).drain();
    expect(await prisma.order.count({ where: { checkoutId: checkout.id } })).toBe(1);
  });

  it('shows customers only their own orders', async () => {
    const { checkout } = await paidOrder();
    const order = await prisma.order.findUniqueOrThrow({ where: { checkoutId: checkout.id } });
    const stranger = await customer();
    expect((await call('GET', `store/orders/${order.id}`, { token: stranger.token })).status).toBe(404);
    expect((await call('GET', `store/orders/by-checkout/${checkout.id}`, { token: stranger.token })).status).toBe(404);
    expect(ok(await call('GET', 'store/orders', { token: stranger.token }))).toEqual([]);
  });

  it('places no order for an unpaid checkout or a payment of the wrong amount', async () => {
    const { token, checkout } = await openCheckout(1);
    const { reference } = ok(await call('POST', `store/checkout/${checkout.id}/payments`, { token, body: { gatewayId: paystackId } }), 201);
    expect((await call('GET', `store/orders/by-checkout/${checkout.id}`, { token })).status).toBe(404);
    fake.transactions.set(reference, { status: 'success', amount: 100, currency: 'NGN', id: txId() });
    expect(ok(await call('POST', `store/payments/${reference}/verify`, { token })).status).toBe('requires_review');
    expect(await prisma.order.count({ where: { checkoutId: checkout.id } })).toBe(0);
  });

  it('needs orders.manage for staff', async () => {
    const viewer = await staffToken(['payments.read']);
    expect((await call('GET', 'admin/orders', { token: viewer })).status).toBe(403);
  });
});

describe('dispatch and delivery', () => {
  let dispatcher: string;
  let clerk: string;

  beforeAll(async () => {
    dispatcher = await staffToken(['orders.manage', 'shipments.manage']);
    clerk = await staffToken(['orders.manage']);
  });

  /** A placed order of 2 × 12,500 plus 2,500 delivery. */
  async function placed() {
    const shopper = await openCheckout(2);
    const { reference } = ok(await call('POST', `store/checkout/${shopper.checkout.id}/payments`, { token: shopper.token, body: { gatewayId: paystackId } }), 201);
    fake.transactions.set(reference, { status: 'success', amount: 2750000, currency: 'NGN', id: txId() });
    ok(await call('POST', `store/payments/${reference}/verify`, { token: shopper.token }));
    const order = ok(await call('GET', `store/orders/by-checkout/${shopper.checkout.id}`, { token: shopper.token }));
    return { ...shopper, order, sellerOrderId: order.sellerOrders[0].id as string };
  }
  const send = (sellerOrderId: string, body: Record<string, unknown> = { courier: 'GIG Logistics', trackingReference: `GIG-${unique()}` }, token = dispatcher) =>
    call('POST', `admin/seller-orders/${sellerOrderId}/shipments`, { token, body });
  const step = (shipmentId: string, status: string, extra: Record<string, unknown> = {}) => call('POST', `admin/shipments/${shipmentId}/status`, { token: dispatcher, body: { status, ...extra } });
  const staffOrder = async (id: string) => ok(await call('GET', `admin/orders/${id}`, { token: clerk }));

  it('records a refund after delivery against refunds, leaving prepayments at zero', async () => {
    const refunder = await staffToken(['payments.read', 'orders.refund']);
    const { order, sellerOrderId } = await placed();
    const shipment = ok(await send(sellerOrderId), 201);
    for (const status of ['picked_up', 'in_transit', 'out_for_delivery', 'delivered']) ok(await step(shipment.id, status));
    await app.get(OutboxRunner).drain();
    expect((await staffOrder(order.id)).status).toBe('fulfilled');

    const { paymentId } = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const payment = { id: paymentId };
    const reply = await call('POST', `admin/payments/${payment.id}/refunds`, { token: refunder, body: { amountMinor: '2750000', reason: 'Returned after delivery' } });
    const sent = ok(reply, 201);
    fake.refunds.set(Number(sent.providerRefundId), 'processed');
    expect(ok(await call('POST', `admin/refunds/${sent.id}/check`, { token: refunder })).status).toBe('succeeded');
    await app.get(OutboxRunner).drain();

    const refundEntry = await prisma.journalEntry.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'refund_paid', sourceId: sent.id } }, include: { lines: true } });
    expect(refundEntry.lines.map((line) => [line.accountCode, line.side, line.amountMinor]).sort()).toEqual([
      ['1100', 'credit', 2750000n],
      ['4900', 'debit', 2750000n],
    ]);
    const net = await prisma.$queryRaw<{ accountCode: string; balance: bigint }[]>`
      SELECT l."accountCode", SUM(CASE WHEN l.side = 'credit' THEN l."amountMinor" ELSE -l."amountMinor" END)::bigint AS balance
      FROM ledger.journal_lines l JOIN ledger.journal_entries e ON e.id = l."entryId"
      WHERE e."paymentId" = ${payment.id}::uuid GROUP BY 1 ORDER BY 1`;
    expect(Object.fromEntries(net.map((row) => [row.accountCode, row.balance]))).toEqual({ '1100': 0n, '2100': 0n, '4000': 2500000n, '4100': 250000n, '4900': -2750000n });
  });

  it('follows a parcel from courier to door, completes the order and recognises the sale in the ledger', async () => {
    const { token, order, sellerOrderId } = await placed();
    const waybill = `GIG ${unique()}/A`;
    const shipment = ok(await send(sellerOrderId, { courier: 'GIG Logistics', trackingReference: waybill }), 201);
    expect(shipment).toMatchObject({ status: 'allocated', courier: 'GIG Logistics', trackingReference: waybill, provider: 'manual_dispatch', items: [{ quantity: 2 }], nextStatuses: ['picked_up', 'cancelled'] });
    expect((await staffOrder(order.id)).sellerOrders[0].status).toBe('pending');

    const toSend = async () => ok(await call('GET', 'admin/orders?toSend=true', { token: clerk })).some((entry: { id: string }) => entry.id === order.id);
    expect(await toSend()).toBe(true);
    expect(ok(await call('GET', 'admin/orders/counts', { token: clerk })).toSend).toBeGreaterThanOrEqual(1);
    ok(await step(shipment.id, 'picked_up', { note: 'Musa collected at 9am' }));
    expect(await staffOrder(order.id)).toMatchObject({ toSend: false, sellerOrders: [{ status: 'dispatched' }] });
    expect(await toSend()).toBe(false);
    ok(await step(shipment.id, 'in_transit'));
    ok(await step(shipment.id, 'out_for_delivery'));
    ok(await step(shipment.id, 'delivery_failed', { note: 'Customer not at home' }));
    ok(await step(shipment.id, 'out_for_delivery'));
    expect(await prisma.journalEntry.count({ where: { sourceType: 'order_delivered', sourceId: order.id } })).toBe(0);
    const done = ok(await step(shipment.id, 'delivered'));
    expect(done.attempts.map((attempt: { successful: boolean }) => attempt.successful)).toEqual([false, true]);

    // The customer sees it delivered, with each step but none of the staff notes.
    expect(ok(await call('GET', `store/orders/${order.id}`, { token }))).toMatchObject({ status: 'fulfilled', sellerOrders: [{ status: 'delivered' }] });
    const [tracking] = ok(await call('GET', `store/orders/${order.id}/shipments`, { token }));
    expect(tracking).toMatchObject({ status: 'delivered', courier: 'GIG Logistics', trackingReference: waybill });
    expect(tracking.history.map((change: { status: string }) => change.status)).toEqual(['created', 'allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivery_failed', 'out_for_delivery', 'delivered']);
    expect(JSON.stringify(tracking)).not.toMatch(/Musa|not at home/);
    expect(tracking.attempts).toBeUndefined();

    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: 'order_delivered', sourceId: order.id } }, include: { lines: true } });
    expect(entry.lines.map((line) => [line.accountCode, line.side, line.amountMinor]).sort()).toEqual([
      ['2100', 'debit', 2750000n],
      ['4000', 'credit', 2500000n],
      ['4100', 'credit', 250000n],
    ]);
    expect(await prisma.auditLog.count({ where: { targetType: 'shipment', targetId: shipment.id } })).toBe(7);
    expect(ok(await call('GET', `admin/orders/${order.id}/shipments`, { token: clerk }))[0].history[2]).toMatchObject({ status: 'picked_up', note: 'Musa collected at 9am' });
  });

  it('posts the sale once and keeps the order delivered however often the events are delivered', async () => {
    const { order, sellerOrderId } = await placed();
    const { id } = ok(await send(sellerOrderId), 201);
    for (const status of ['picked_up', 'in_transit', 'out_for_delivery', 'delivered']) ok(await step(id, status));
    ok(await step(id, 'delivered'));
    await prisma.outboxEvent.updateMany({ where: { aggregateId: { in: [id, order.id] } }, data: { publishedAt: null, attempts: 0 } });
    await app.get(OutboxRunner).drain();
    expect(await prisma.journalEntry.count({ where: { sourceType: 'order_delivered', sourceId: order.id } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { type: 'OrderFulfilled', aggregateId: order.id } })).toBe(1);
    expect((await staffOrder(order.id)).status).toBe('fulfilled');
  });

  it('sends items once, even when two people press send together, and again only after a cancellation', async () => {
    const { order, sellerOrderId } = await placed();
    const replies = await Promise.all([send(sellerOrderId), send(sellerOrderId)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([201, 409]);
    const taken = replies.find((reply) => reply.status === 201)!.body.trackingReference;
    const other = await placed();
    expect((await send(other.sellerOrderId, { courier: 'GIG Logistics', trackingReference: taken })).body).toMatchObject({ status: 409, code: 'shipment.tracking_taken' });
    const first = replies.find((reply) => reply.status === 201)!.body;
    expect((await send(sellerOrderId)).body).toMatchObject({ status: 409, code: 'shipment.already_open' });
    ok(await step(first.id, 'cancelled', { version: first.version }));
    ok(await send(sellerOrderId, { courier: 'Our rider' }), 201);
    expect(ok(await call('GET', `admin/orders/${order.id}/shipments`, { token: clerk })).map((entry: { status: string }) => entry.status)).toEqual(['cancelled', 'allocated']);
  });

  it('puts returned items back in the queue to send again', async () => {
    const { order, sellerOrderId } = await placed();
    const { id } = ok(await send(sellerOrderId), 201);
    for (const status of ['picked_up', 'in_transit', 'out_for_delivery']) ok(await step(id, status));
    ok(await step(id, 'delivery_failed', { note: 'Refused at the door' }));
    ok(await step(id, 'returning'));
    expect((await staffOrder(order.id)).sellerOrders[0].status).toBe('dispatched');
    ok(await step(id, 'returned'));
    expect(await staffOrder(order.id)).toMatchObject({ status: 'placed', sellerOrders: [{ status: 'pending' }] });
    expect((await send(sellerOrderId)).status).toBe(201);
  });

  it('refuses skipped steps, a failure with no reason, stale changes, and sending delivered items', async () => {
    const { sellerOrderId } = await placed();
    const shipment = ok(await send(sellerOrderId), 201);
    expect((await step(shipment.id, 'delivered')).body).toMatchObject({ status: 422, code: 'shipment.not_out_for_delivery' });
    expect((await step(shipment.id, 'in_transit')).body).toMatchObject({ status: 422, code: 'shipment.invalid_transition' });
    ok(await step(shipment.id, 'picked_up', { version: shipment.version }));
    expect((await step(shipment.id, 'cancelled', { version: shipment.version })).body).toMatchObject({ status: 409, code: 'shipment.changed' });
    for (const status of ['in_transit', 'out_for_delivery']) ok(await step(shipment.id, status));
    expect((await step(shipment.id, 'delivery_failed')).status).toBe(400);
    ok(await step(shipment.id, 'delivered'));
    expect((await send(sellerOrderId)).body).toMatchObject({ status: 422, code: 'order.not_shippable' });
  });

  it('lists shipments on their way, with the order they belong to', async () => {
    const { order, sellerOrderId } = await placed();
    const { id } = ok(await send(sellerOrderId), 201);
    const open = ok(await call('GET', 'admin/shipments', { token: dispatcher }));
    expect(open.find((entry: { id: string }) => entry.id === id)).toMatchObject({ order: { orderId: order.id, orderNumber: order.number, city: 'Ikeja', itemCount: 2 } });
    expect(ok(await call('GET', 'admin/shipments?status=picked_up', { token: dispatcher })).some((entry: { id: string }) => entry.id === id)).toBe(false);
  });

  it('needs shipments.manage to send or update, and shows customers only their own parcels', async () => {
    const { order, sellerOrderId } = await placed();
    expect((await send(sellerOrderId, { courier: 'GIG' }, clerk)).status).toBe(403);
    expect((await call('GET', 'admin/shipments', { token: clerk })).status).toBe(403);
    const { id } = ok(await send(sellerOrderId), 201);
    expect((await call('POST', `admin/shipments/${id}/status`, { token: clerk, body: { status: 'picked_up' } })).status).toBe(403);
    const stranger = await customer();
    expect((await call('GET', `store/orders/${order.id}/shipments`, { token: stranger.token })).status).toBe(404);
    expect((await send(randomUUID())).status).toBe(404);
  });
});

describe('event delivery', () => {
  it('leaves nothing pending after a payment', async () => {
    await app.get(OutboxRunner).drain();
    const ours = await prisma.payment.findMany({ where: { gatewayId: { in: [paystackId, flutterwaveId] } }, select: { id: true } });
    const pending = await prisma.outboxEvent.count({ where: { publishedAt: null, type: 'PaymentSucceeded', aggregateId: { in: ours.map((payment) => payment.id) } } });
    expect(ours.length).toBeGreaterThan(0);
    expect(pending).toBe(0);
  });
});

// Runs last: every journal entry written by the payments, refunds and deliveries above.
describe('ledger after the whole run', () => {
  it('balances every journal entry, in each currency, with at least two lines', async () => {
    const unbalanced = await prisma.$queryRaw<{ entryId: string }[]>`
      SELECT e.id AS "entryId"
      FROM ledger.journal_entries e
      LEFT JOIN ledger.journal_lines l ON l."entryId" = e.id
      GROUP BY e.id
      HAVING COUNT(l.id) < 2
          OR EXISTS (
            SELECT 1 FROM ledger.journal_lines x WHERE x."entryId" = e.id
            GROUP BY x.currency
            HAVING SUM(CASE WHEN x.side = 'debit' THEN x."amountMinor" ELSE -x."amountMinor" END) <> 0
          )`;
    expect(unbalanced).toEqual([]);
    expect(await prisma.journalEntry.count()).toBeGreaterThan(5);
  });
});
