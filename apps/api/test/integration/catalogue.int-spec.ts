import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/bootstrap';
import { StaffService } from '../../src/modules/identity';
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions';
import { FIRST_PARTY_SELLER_ID, Principal } from '../../src/shared-kernel';

const prisma = new PrismaClient();
const PASSWORD = 'a-long-enough-password';
let app: INestApplication;
let base: string;
let manager: string;

interface Reply {
  status: number;
  body: any;
}

async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
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

const unique = () => randomUUID().slice(0, 8);

async function staffToken(permissions: readonly string[]): Promise<string> {
  const staff = app.get(StaffService);
  const root: Principal = { accountId: randomUUID(), sessionId: randomUUID(), audience: 'admin', permissions: PERMISSIONS };
  const role = await staff.createRole(root, `role_${randomUUID()}`, permissions);
  const email = `staff_${randomUUID()}@example.com`;
  await staff.createStaff(root, email, PASSWORD, [role.id]);
  const reply = await call('POST', 'admin/auth/login', { body: { email, password: PASSWORD } });
  return reply.body.accessToken;
}

const phoneAttributes = [
  { key: 'screen_size', label: 'Screen size', type: 'number', required: true },
  { key: 'network', label: 'Network', type: 'select', options: ['4G', '5G'], required: true },
];

async function category(attributes: unknown[] = phoneAttributes) {
  const reply = await call('POST', 'admin/categories', { token: manager, body: { name: `Phones ${unique()}`, attributes } });
  expect(reply.status).toBe(201);
  return reply.body;
}

async function product(attributes: Record<string, unknown> = { screen_size: 6.6, network: '4G' }) {
  const cat = await category();
  const reply = await call('POST', 'admin/products', {
    token: manager,
    body: { name: `Tecno Spark ${unique()}`, categoryId: cat.id, description: 'Phone', attributes },
  });
  expect(reply.status).toBe(201);
  return reply.body;
}

async function sellableVariant() {
  const created = await product();
  const variant = await call('POST', `admin/products/${created.id}/variants`, {
    token: manager,
    body: { sku: `SKU-${unique()}`, weightGrams: 190, options: { colour: 'Black' } },
  });
  expect(variant.status).toBe(201);
  return { product: created, variant: variant.body };
}

async function listing() {
  const { product: created, variant } = await sellableVariant();
  const reply = await call('POST', 'admin/listings', {
    token: manager,
    body: { variantId: variant.id, priceMinor: '1500000', currency: 'NGN' },
  });
  expect(reply.status).toBe(201);
  return { product: created, variant, listing: reply.body };
}

async function warehouse() {
  const reply = await call('POST', 'admin/warehouses', {
    token: manager,
    body: { name: `Lagos ${unique()}`, address: { line1: '1 Allen Avenue', city: 'Ikeja', state: 'Lagos' } },
  });
  expect(reply.status).toBe(201);
  return reply.body;
}

const adjust = (body: Record<string, unknown>, key: string = randomUUID()) =>
  call('POST', 'admin/stock/adjustments', { token: manager, body, headers: { 'idempotency-key': key } });

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  await prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:' } } });
  manager = await staffToken(['catalogue.manage', 'inventory.manage']);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('permissions', () => {
  it.each([
    ['GET', 'admin/categories'],
    ['POST', 'admin/products'],
    ['POST', 'admin/listings'],
  ])('%s %s needs catalogue.manage', async (method, path) => {
    const token = await staffToken(['inventory.manage']);
    expect((await call(method, path, { token, body: method === 'POST' ? {} : undefined })).status).toBe(403);
  });

  it.each([
    ['GET', 'admin/warehouses'],
    ['POST', 'admin/stock/adjustments'],
  ])('%s %s needs inventory.manage', async (method, path) => {
    const token = await staffToken(['catalogue.manage']);
    expect((await call(method, path, { token, body: method === 'POST' ? {} : undefined })).status).toBe(403);
  });

  it('rejects a customer token', async () => {
    const reply = await call('POST', 'store/auth/register', { body: { email: `c_${randomUUID()}@example.com`, password: PASSWORD } });
    expect((await call('GET', 'admin/products', { token: reply.body.accessToken })).status).toBe(401);
  });
});

describe('categories and brands', () => {
  it('stores category attributes and rejects an invalid schema', async () => {
    const created = await category();
    expect(created.attributes.map((a: { key: string }) => a.key)).toEqual(['screen_size', 'network']);
    const bad = await call('POST', 'admin/categories', {
      token: manager,
      body: { name: `Bad ${unique()}`, attributes: [{ key: 'Bad Key', label: 'x', type: 'text' }] },
    });
    expect(bad.status).toBe(422);
  });

  it('rejects duplicate category slugs and brand names', async () => {
    const name = `Laptops ${unique()}`;
    await call('POST', 'admin/categories', { token: manager, body: { name } });
    expect((await call('POST', 'admin/categories', { token: manager, body: { name } })).status).toBe(409);
    const brand = `Tecno ${unique()}`;
    expect((await call('POST', 'admin/brands', { token: manager, body: { name: brand } })).status).toBe(201);
    expect((await call('POST', 'admin/brands', { token: manager, body: { name: brand } })).status).toBe(409);
  });

  it('rejects an unknown parent category', async () => {
    const reply = await call('POST', 'admin/categories', { token: manager, body: { name: `Sub ${unique()}`, parentId: randomUUID() } });
    expect(reply.status).toBe(404);
  });

  it('audits category changes with before and after', async () => {
    const created = await category();
    await call('PATCH', `admin/categories/${created.id}`, { token: manager, body: { name: 'Renamed phones', attributes: [] } });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { targetId: created.id, action: 'catalogue.category_updated' } });
    expect(entry.before).toMatchObject({ name: created.name });
    expect(entry.after).toMatchObject({ name: 'Renamed phones' });
  });
});

describe('products', () => {
  it('validates attributes against the category', async () => {
    const cat = await category();
    const reply = await call('POST', 'admin/products', {
      token: manager,
      body: { name: `Phone ${unique()}`, categoryId: cat.id, attributes: { network: '3G' } },
    });
    expect(reply.status).toBe(422);
    expect(reply.body.code).toBe('product.invalid_attributes');
  });

  it('rejects an unknown category or brand', async () => {
    const cat = await category();
    expect((await call('POST', 'admin/products', { token: manager, body: { name: 'Phone', categoryId: randomUUID() } })).status).toBe(404);
    expect(
      (await call('POST', 'admin/products', { token: manager, body: { name: 'Phone', categoryId: cat.id, brandId: randomUUID() } })).status,
    ).toBe(404);
  });

  it('cannot publish without a variant, or with required attributes missing', async () => {
    const noVariant = await product();
    expect((await call('POST', `admin/products/${noVariant.id}/publish`, { token: manager })).body.code).toBe('product.no_variants');
    const incomplete = await product({ screen_size: 6.6 });
    await call('POST', `admin/products/${incomplete.id}/variants`, { token: manager, body: { sku: `I-${unique()}`, weightGrams: 100 } });
    const reply = await call('POST', `admin/products/${incomplete.id}/publish`, { token: manager });
    expect(reply.status).toBe(422);
    expect(reply.body.detail).toContain('Network');
  });

  it('publishes, records an event and an audit entry', async () => {
    const { product: created } = await sellableVariant();
    const reply = await call('POST', `admin/products/${created.id}/publish`, { token: manager });
    expect(reply.status).toBe(200);
    expect(reply.body.status).toBe('published');
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: created.id } });
    expect(events.map((e) => e.type)).toEqual(['ProductPublished']);
    await expect(prisma.auditLog.count({ where: { targetId: created.id, action: 'catalogue.product_published' } })).resolves.toBe(1);
  });

  it('rejects a duplicate SKU across products', async () => {
    const sku = `DUP-${unique()}`;
    const first = await product();
    const second = await product();
    expect((await call('POST', `admin/products/${first.id}/variants`, { token: manager, body: { sku, weightGrams: 1 } })).status).toBe(201);
    const reply = await call('POST', `admin/products/${second.id}/variants`, { token: manager, body: { sku, weightGrams: 1 } });
    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe('variant.sku_taken');
  });

  it('rejects a duplicate product web address', async () => {
    const cat = await category();
    const slug = `same-${unique()}`;
    const body = { name: 'Phone', categoryId: cat.id, slug };
    expect((await call('POST', 'admin/products', { token: manager, body })).status).toBe(201);
    expect((await call('POST', 'admin/products', { token: manager, body })).body.code).toBe('product.slug_taken');
  });

  it('rejects a stale concurrent edit', async () => {
    const created = await product();
    const edit = (name: string) =>
      call('PATCH', `admin/products/${created.id}`, {
        token: manager,
        body: { name, description: '', brandId: null, attributes: { screen_size: 6.6, network: '4G' } },
      });
    const replies = await Promise.all([edit('First name'), edit('Second name'), edit('Third name')]);
    expect(replies.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(replies.every((r) => r.status === 200 || r.status === 409)).toBe(true);
  });

  it('lists and paginates', async () => {
    await product();
    await product();
    const first = await call('GET', 'admin/products?limit=1', { token: manager });
    const second = await call('GET', `admin/products?limit=1&cursor=${first.body[0].id}`, { token: manager });
    expect(second.body[0].id).not.toBe(first.body[0].id);
  });
});

describe('listings', () => {
  it('belongs to Vendra and returns money as a string', async () => {
    const { listing: created } = await listing();
    expect(created.sellerId).toBe(FIRST_PARTY_SELLER_ID);
    expect(created.price).toEqual({ amountMinor: '1500000', currency: 'NGN' });
    expect(created.status).toBe('draft');
  });

  it.each([
    ['zero', '0', 'NGN', 422],
    ['a decimal', '15000.50', 'NGN', 400],
    ['a negative', '-1', 'NGN', 400],
    ['another currency', '1000', 'USD', 422],
  ])('rejects %s price', async (_name, priceMinor, currency, status) => {
    const { variant } = await sellableVariant();
    expect((await call('POST', 'admin/listings', { token: manager, body: { variantId: variant.id, priceMinor, currency } })).status).toBe(status);
  });

  it('allows one Vendra listing per variant', async () => {
    const { variant } = await listing();
    const reply = await call('POST', 'admin/listings', { token: manager, body: { variantId: variant.id, priceMinor: '1000', currency: 'NGN' } });
    expect(reply.status).toBe(409);
  });

  it('cannot activate until the product is published', async () => {
    const { product: created, listing: created2 } = await listing();
    expect((await call('POST', `admin/listings/${created2.id}/activate`, { token: manager })).body.code).toBe('listing.product_not_published');
    await call('POST', `admin/products/${created.id}/publish`, { token: manager });
    expect((await call('POST', `admin/listings/${created2.id}/activate`, { token: manager })).body.status).toBe('active');
  });

  it('audits price changes with the old and new price', async () => {
    const { listing: created } = await listing();
    const reply = await call('PUT', `admin/listings/${created.id}/price`, { token: manager, body: { priceMinor: '1450000', currency: 'NGN' } });
    expect(reply.body.price.amountMinor).toBe('1450000');
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { targetId: created.id, action: 'listing.price_changed' } });
    expect([entry.before, entry.after]).toEqual([{ priceMinor: '1500000' }, { priceMinor: '1450000' }]);
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: created.id } });
    expect(events.map((e) => e.type)).toEqual(['ListingPriceChanged']);
  });

  it('lists the listings of a product', async () => {
    const { product: created, listing: created2 } = await listing();
    const reply = await call('GET', `admin/listings?productId=${created.id}`, { token: manager });
    expect(reply.body.map((l: { id: string }) => l.id)).toEqual([created2.id]);
  });
});

describe('stock', () => {
  it('requires an idempotency key', async () => {
    const reply = await call('POST', 'admin/stock/adjustments', { token: manager, body: {} });
    expect(reply.status).toBe(400);
  });

  it('receives stock and reports what is available', async () => {
    const { listing: created } = await listing();
    const store = await warehouse();
    const reply = await adjust({ listingId: created.id, warehouseId: store.id, delta: 25, reason: 'receipt' });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ onHand: 25, reserved: 0, available: 25 });
  });

  it('never applies the same key twice', async () => {
    const { listing: created } = await listing();
    const store = await warehouse();
    const key = randomUUID();
    const body = { listingId: created.id, warehouseId: store.id, delta: 10, reason: 'receipt' };
    await adjust(body, key);
    const again = await adjust(body, key);
    expect(again.body.onHand).toBe(10);
    await expect(prisma.stockMovement.count({ where: { sourceId: key } })).resolves.toBe(1);
  });

  it('applies concurrent retries of one key exactly once', async () => {
    const { listing: created } = await listing();
    const store = await warehouse();
    const key = randomUUID();
    const body = { listingId: created.id, warehouseId: store.id, delta: 7, reason: 'receipt' };
    const replies = await Promise.all([1, 2, 3, 4].map(() => adjust(body, key)));
    expect(replies.every((r) => r.status === 201)).toBe(true);
    expect(replies.every((r) => r.body.onHand === 7)).toBe(true);
    await expect(prisma.stockMovement.count({ where: { sourceId: key } })).resolves.toBe(1);
  });

  it('keeps the total right when different adjustments race', async () => {
    const { listing: created } = await listing();
    const store = await warehouse();
    const body = { listingId: created.id, warehouseId: store.id, delta: 1, reason: 'receipt' };
    await adjust(body);
    const replies = await Promise.all([1, 2, 3, 4, 5].map(() => adjust(body)));
    const applied = replies.filter((r) => r.status === 201).length;
    expect(replies.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const item = await prisma.stockItem.findFirstOrThrow({ where: { listingId: created.id } });
    expect(item.onHand).toBe(1 + applied);
    await expect(prisma.stockMovement.count({ where: { stockItemId: item.id } })).resolves.toBe(1 + applied);
  });

  it('refuses a key reused for a different request', async () => {
    const { listing: created } = await listing();
    const first = await warehouse();
    const second = await warehouse();
    const key = randomUUID();
    await adjust({ listingId: created.id, warehouseId: first.id, delta: 1, reason: 'receipt' }, key);
    const reply = await adjust({ listingId: created.id, warehouseId: second.id, delta: 1, reason: 'receipt' }, key);
    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe('idempotency.key_reused');
  });

  it('cannot go negative, even directly in the database', async () => {
    const { listing: created } = await listing();
    const store = await warehouse();
    await adjust({ listingId: created.id, warehouseId: store.id, delta: 2, reason: 'receipt' });
    const reply = await adjust({ listingId: created.id, warehouseId: store.id, delta: -3, reason: 'correction' });
    expect(reply.status).toBe(422);
    expect(reply.body.code).toBe('stock.insufficient');
    await expect(prisma.stockItem.updateMany({ where: { listingId: created.id }, data: { onHand: -1 } })).rejects.toThrow();
  });

  it('rejects an unknown listing or warehouse', async () => {
    const { listing: created } = await listing();
    const store = await warehouse();
    expect((await adjust({ listingId: randomUUID(), warehouseId: store.id, delta: 1, reason: 'receipt' })).status).toBe(404);
    expect((await adjust({ listingId: created.id, warehouseId: randomUUID(), delta: 1, reason: 'receipt' })).status).toBe(404);
  });

  it('audits adjustments and lists stock by product', async () => {
    const { product: created, listing: created2 } = await listing();
    const store = await warehouse();
    await adjust({ listingId: created2.id, warehouseId: store.id, delta: 4, reason: 'receipt' });
    const item = await prisma.stockItem.findFirstOrThrow({ where: { listingId: created2.id } });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { targetId: item.id, action: 'inventory.stock_adjusted' } });
    expect([entry.before, entry.after]).toEqual([{ onHand: 0 }, { onHand: 4, delta: 4, reason: 'receipt' }]);
    const reply = await call('GET', `admin/stock?productId=${created.id}`, { token: manager });
    expect(reply.body).toEqual([{ listingId: created2.id, warehouseId: store.id, onHand: 4, reserved: 0, available: 4 }]);
  });
});

describe('visitor address from portals', () => {
  const failLogin = (headers: Record<string, string>) =>
    call('POST', 'store/auth/login', { body: { email: `nobody_${randomUUID()}@example.com`, password: 'wrong-password-here' }, headers });

  it('uses the forwarded address only with the shared secret', async () => {
    const secret = process.env.PORTAL_SHARED_SECRET!;
    await failLogin({ 'x-vendra-portal-key': secret, 'x-vendra-client-ip': '203.0.113.7' });
    await failLogin({ 'x-vendra-portal-key': 'wrong-secret-wrong-secret-wrong-secret-xx', 'x-vendra-client-ip': '198.51.100.9' });
    await failLogin({ 'x-vendra-client-ip': '198.51.100.10' });
    await expect(prisma.loginFailure.count({ where: { key: 'ip:203.0.113.7' } })).resolves.toBe(1);
    await expect(prisma.loginFailure.count({ where: { key: { in: ['ip:198.51.100.9', 'ip:198.51.100.10'] } } })).resolves.toBe(0);
  });

  it('ignores a forwarded value that is not an IP address', async () => {
    await failLogin({ 'x-vendra-portal-key': process.env.PORTAL_SHARED_SECRET!, 'x-vendra-client-ip': 'not-an-ip' });
    await expect(prisma.loginFailure.count({ where: { key: 'ip:not-an-ip' } })).resolves.toBe(0);
  });
});
