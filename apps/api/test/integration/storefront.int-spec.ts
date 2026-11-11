import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/bootstrap';
import { StaffService } from '../../src/modules/identity';
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions';
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
  headers: Headers;
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
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

const store = (path: string) => call('GET', `store/${path}`);
const ok = (reply: Reply, status = 200) => {
  expect({ status: reply.status, body: reply.body }).toMatchObject({ status });
  return reply.body;
};
/** A made-up word unique to one test, so earlier test data never matches its searches. */
const word = () =>
  `zq${randomUUID()
    .replace(/-/g, '')
    .slice(0, 12)
    .replace(/\d/g, (digit) => 'ghijklmnop'[Number(digit)]!)}`;

async function staffToken(permissions: readonly string[]): Promise<string> {
  const staff = app.get(StaffService);
  const root: Principal = { accountId: randomUUID(), sessionId: randomUUID(), audience: 'admin', permissions: PERMISSIONS };
  const role = await staff.createRole(root, `role_${randomUUID()}`, permissions);
  const email = `staff_${randomUUID()}@example.com`;
  await staff.createStaff(root, email, PASSWORD, [role.id]);
  return (await call('POST', 'admin/auth/login', { body: { email, password: PASSWORD } })).body.accessToken;
}

const admin = (method: string, path: string, body?: unknown) => call(method, `admin/${path}`, { token: manager, body });

async function newCategory(name = `Cat ${word()}`, parentId: string | null = null) {
  return ok(await admin('POST', 'categories', { name, parentId, attributes: [{ key: 'colour', label: 'Colour', type: 'text', required: false }] }), 201);
}

interface Sellable {
  product: { id: string; slug: string; name: string };
  variantId: string;
  listingId: string;
}

/** A product taken as far as requested: draft, published, priced, on sale, stocked. */
async function makeProduct(options: {
  name: string;
  categoryId: string;
  description?: string;
  brandId?: string | null;
  publish?: boolean;
  priceMinor?: string;
  activate?: boolean;
  stock?: number;
}): Promise<Sellable> {
  const product = ok(
    await admin('POST', 'products', {
      name: options.name,
      categoryId: options.categoryId,
      description: options.description ?? 'A test product',
      brandId: options.brandId ?? null,
      attributes: { colour: 'Indigo' },
    }),
    201,
  );
  const variant = ok(await admin('POST', `products/${product.id}/variants`, { sku: `SKU-${word()}`, weightGrams: 300, options: { Size: 'M' } }), 201);
  if (options.publish !== false) ok(await admin('POST', `products/${product.id}/publish`));
  const listing = ok(await admin('POST', 'listings', { variantId: variant.id, priceMinor: options.priceMinor ?? '1500000', currency: 'NGN' }), 201);
  if (options.publish !== false && options.activate !== false) ok(await admin('POST', `listings/${listing.id}/activate`));
  if (options.stock) {
    const reply = await call('POST', 'admin/stock/adjustments', {
      token: manager,
      headers: { 'idempotency-key': randomUUID() },
      body: { listingId: listing.id, warehouseId, delta: options.stock, reason: 'receipt' },
    });
    ok(reply, 201);
  }
  return { product, variantId: variant.id, listingId: listing.id };
}

const slugsIn = (body: { items: { slug: string }[] }) => body.items.map((item) => item.slug);

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  await prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:' } } });
  manager = await staffToken(['catalogue.manage', 'inventory.manage']);
  warehouseId = ok(await admin('POST', 'warehouses', { name: `WH ${word()}`, address: { line1: '1 Allen Avenue', city: 'Ikeja', state: 'Lagos' } }), 201).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('what customers can see', () => {
  it('needs no account', async () => {
    expect((await store('products')).status).toBe(200);
    expect((await store('categories')).status).toBe(200);
  });

  it('shows a product only once it is published and on sale', async () => {
    const category = await newCategory();
    const draft = await makeProduct({ name: `Draft ${word()}`, categoryId: category.id, publish: false });
    const unlisted = await makeProduct({ name: `Unlisted ${word()}`, categoryId: category.id, activate: false });
    const live = await makeProduct({ name: `Live ${word()}`, categoryId: category.id, stock: 10 });

    const listed = ok(await store(`products?category=${category.slug}`));
    expect(slugsIn(listed)).toEqual([live.product.slug]);
    for (const hidden of [draft, unlisted]) {
      expect((await store(`products/${hidden.product.slug}`)).status).toBe(404);
    }
    expect(ok(await store(`products/${live.product.slug}`)).name).toBe(live.product.name);
  });

  it('hides an archived product even while its listing is still active', async () => {
    const category = await newCategory();
    const item = await makeProduct({ name: `Archived ${word()}`, categoryId: category.id, stock: 5 });
    expect(slugsIn(ok(await store(`products?category=${category.slug}`)))).toEqual([item.product.slug]);
    ok(await admin('POST', `products/${item.product.id}/archive`));
    const listing = ok(await admin('GET', `listings?productId=${item.product.id}`));
    expect(listing[0].status).toBe('active');
    expect(ok(await store(`products?category=${category.slug}`)).items).toEqual([]);
    expect((await store(`products/${item.product.slug}`)).status).toBe(404);
  });

  it('hides a product when its listing is taken off sale', async () => {
    const category = await newCategory();
    const item = await makeProduct({ name: `Paused ${word()}`, categoryId: category.id });
    ok(await admin('POST', `listings/${item.listingId}/deactivate`));
    expect(ok(await store(`products?category=${category.slug}`)).items).toEqual([]);
  });

  it('lists only categories with published products, counting subcategories', async () => {
    const parent = await newCategory();
    const child = await newCategory(`Child ${word()}`, parent.id);
    const empty = await newCategory();
    await makeProduct({ name: `Kid ${word()}`, categoryId: child.id });
    const categories: { slug: string; productCount: number; parentId: string | null }[] = ok(await store('categories'));
    const find = (slug: string) => categories.find((entry) => entry.slug === slug);
    expect(find(parent.slug)).toMatchObject({ productCount: 1, parentId: null });
    expect(find(child.slug)).toMatchObject({ productCount: 1, parentId: parent.id });
    expect(find(empty.slug)).toBeUndefined();
  });
});

describe('prices and availability', () => {
  it('shows the price exactly, in kobo as a string', async () => {
    const category = await newCategory();
    const item = await makeProduct({ name: `Priced ${word()}`, categoryId: category.id, priceMinor: '14999950', stock: 9 });
    const [card] = ok(await store(`products?category=${category.slug}`)).items;
    expect(card.priceFrom).toEqual({ amountMinor: '14999950', currency: 'NGN' });
    const page = ok(await store(`products/${item.product.slug}`));
    expect(page.variants[0].offer.price).toEqual({ amountMinor: '14999950', currency: 'NGN' });
  });

  it('reports out of stock, low stock with the count, and in stock without it', async () => {
    const category = await newCategory();
    const item = await makeProduct({ name: `Stocked ${word()}`, categoryId: category.id });
    const offer = async () => ok(await store(`products/${item.product.slug}`)).variants[0].offer;
    expect(await offer()).toMatchObject({ availability: 'out_of_stock', lowStockQuantity: null });

    const adjust = (delta: number) =>
      call('POST', 'admin/stock/adjustments', {
        token: manager,
        headers: { 'idempotency-key': randomUUID() },
        body: { listingId: item.listingId, warehouseId, delta, reason: delta > 0 ? 'receipt' : 'damaged' },
      });
    ok(await adjust(3), 201);
    expect(await offer()).toMatchObject({ availability: 'low_stock', lowStockQuantity: 3 });
    ok(await adjust(20), 201);
    expect(await offer()).toMatchObject({ availability: 'in_stock', lowStockQuantity: null });
    expect(JSON.stringify(ok(await store(`products/${item.product.slug}`)))).not.toContain('"23"');
  });

  it('does not expose stock counts, seller IDs or internal fields', async () => {
    const category = await newCategory();
    const item = await makeProduct({ name: `Private ${word()}`, categoryId: category.id, stock: 50 });
    const body = JSON.stringify(ok(await store(`products/${item.product.slug}`)));
    for (const field of ['onHand', 'reserved', 'sellerId', 'version', 'status', 'weightGrams', 'searchVector']) {
      expect(body).not.toContain(`"${field}"`);
    }
  });

  it('lists options in the order staff added them, not by SKU', async () => {
    const category = await newCategory();
    const item = await makeProduct({ name: `Sized ${word()}`, categoryId: category.id });
    const tag = word().toUpperCase();
    for (const [sku, size] of [[`C-${tag}`, 'S'], [`B-${tag}`, 'M'], [`A-${tag}`, 'L']] as const) {
      const variant = ok(await admin('POST', `products/${item.product.id}/variants`, { sku, weightGrams: 300, options: { Size: size } }), 201);
      const listing = ok(await admin('POST', 'listings', { variantId: variant.id, priceMinor: '1000000', currency: 'NGN' }), 201);
      ok(await admin('POST', `listings/${listing.id}/activate`));
    }
    const page = ok(await store(`products/${item.product.slug}`));
    expect(page.variants.map((variant: { options: { Size: string } }) => variant.options.Size)).toEqual(['M', 'S', 'M', 'L']);
  });

  it('shows labelled details and the category trail', async () => {
    const parent = await newCategory(`Fashion ${word()}`);
    const child = await newCategory(`Shirts ${word()}`, parent.id);
    const item = await makeProduct({ name: `Detail ${word()}`, categoryId: child.id });
    const page = ok(await store(`products/${item.product.slug}`));
    expect(page.attributes).toEqual([{ label: 'Colour', value: 'Indigo' }]);
    expect(page.breadcrumb.map((entry: { slug: string }) => entry.slug)).toEqual([parent.slug, child.slug]);
  });
});

describe('search', () => {
  it('finds by name, by a word in the description, by brand and by category name', async () => {
    const category = await newCategory();
    const [nameWord, descriptionWord, brandWord] = [word(), word(), word()];
    const brand = ok(await admin('POST', 'brands', { name: `Brand${brandWord}` }), 201);
    const byName = await makeProduct({ name: `Shirt ${nameWord}`, categoryId: category.id });
    const byDescription = await makeProduct({ name: `Plain ${word()}`, categoryId: category.id, description: `Hand dyed ${descriptionWord} cotton` });
    const byBrand = await makeProduct({ name: `Branded ${word()}`, categoryId: category.id, brandId: brand.id });

    expect(slugsIn(ok(await store(`products?q=${nameWord}`)))).toEqual([byName.product.slug]);
    expect(slugsIn(ok(await store(`products?q=${descriptionWord}`)))).toEqual([byDescription.product.slug]);
    expect(slugsIn(ok(await store(`products?q=Brand${brandWord}`)))).toEqual([byBrand.product.slug]);
    expect(slugsIn(ok(await store(`products?q=${category.name.split(' ')[1]}`))).sort()).toEqual(
      [byName, byDescription, byBrand].map((item) => item.product.slug).sort(),
    );
  });

  it('tolerates a typo in the product name', async () => {
    const category = await newCategory();
    const name = `Agbadaqxv${word()}`;
    const item = await makeProduct({ name, categoryId: category.id });
    // Drop one letter, as a hurried shopper would.
    const typo = name.slice(0, 4) + name.slice(5);
    expect(slugsIn(ok(await store(`products?q=${encodeURIComponent(typo)}`)))).toContain(item.product.slug);
  });

  it('ignores accents and case', async () => {
    const category = await newCategory();
    const base = word();
    const item = await makeProduct({ name: `Café ${base}`, categoryId: category.id });
    expect(slugsIn(ok(await store(`products?q=CAFE%20${base.toUpperCase()}`)))).toEqual([item.product.slug]);
  });

  it('ranks a name match above a description match', async () => {
    const category = await newCategory();
    const shared = word();
    const inDescription = await makeProduct({ name: `First ${word()}`, categoryId: category.id, description: `Pairs well with ${shared}` });
    const inName = await makeProduct({ name: `${shared} wrapper`, categoryId: category.id });
    expect(slugsIn(ok(await store(`products?q=${shared}`)))).toEqual([inName.product.slug, inDescription.product.slug]);
  });

  it('never returns hidden products, whatever the query', async () => {
    const category = await newCategory();
    const secret = word();
    await makeProduct({ name: `Hidden ${secret}`, categoryId: category.id, publish: false });
    await makeProduct({ name: `Unpriced ${secret}`, categoryId: category.id, activate: false });
    expect(ok(await store(`products?q=${secret}`)).items).toEqual([]);
  });

  it('treats SQL and search syntax in the query as plain text', async () => {
    for (const q of ["'); DROP TABLE catalogue.products; --", '" OR 1=1', 'a & | ! ( ) :*', '%', '\\']) {
      const reply = await store(`products?q=${encodeURIComponent(q)}`);
      expect(reply.status).toBe(200);
    }
    expect((await prisma.product.count()) > 0).toBe(true);
  });

  it('filters search by category and brand', async () => {
    const [phones, shirts] = [await newCategory(), await newCategory()];
    const shared = word();
    const brand = ok(await admin('POST', 'brands', { name: `Maker ${word()}` }), 201);
    const phone = await makeProduct({ name: `${shared} phone`, categoryId: phones.id, brandId: brand.id });
    const shirt = await makeProduct({ name: `${shared} shirt`, categoryId: shirts.id });
    expect(slugsIn(ok(await store(`products?q=${shared}&category=${phones.slug}`)))).toEqual([phone.product.slug]);
    expect(slugsIn(ok(await store(`products?q=${shared}&brand=${brand.slug}`)))).toEqual([phone.product.slug]);
    expect(slugsIn(ok(await store(`products?q=${shared}`))).sort()).toEqual([phone.product.slug, shirt.product.slug].sort());
  });
});

describe('paging', () => {
  it('browses newest first with no gaps or repeats, including across hidden products', async () => {
    const category = await newCategory();
    const made: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const item = await makeProduct({ name: `Page ${index} ${word()}`, categoryId: category.id, activate: index % 3 !== 1 });
      if (index % 3 !== 1) made.push(item.product.slug);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const body: { items: { slug: string }[]; nextCursor: string | null } = ok(
        await store(`products?category=${category.slug}&limit=2${cursor ? `&cursor=${cursor}` : ''}`),
      );
      seen.push(...slugsIn(body));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([...made].reverse());
  });

  it('pages through search results', async () => {
    const category = await newCategory();
    const shared = word();
    for (let index = 0; index < 5; index += 1) await makeProduct({ name: `${shared} item ${word()}`, categoryId: category.id });
    const first = ok(await store(`products?q=${shared}&limit=3`));
    const second = ok(await store(`products?q=${shared}&limit=3&cursor=${first.nextCursor}`));
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...slugsIn(first), ...slugsIn(second)]).size).toBe(5);
  });

  it('rejects a tampered cursor, or one from the other kind of list', async () => {
    const browse = ok(await store('products?limit=1'));
    expect((await store(`products?q=anything&cursor=${browse.nextCursor}`)).status).toBe(422);
    expect((await store('products?cursor=bm9wZQ')).status).toBe(422);
  });
});

describe('bad requests', () => {
  it.each([
    ['an unknown category', 'products?category=no-such-category-anywhere', 404],
    ['an unknown brand', 'products?brand=no-such-brand-anywhere', 404],
    ['a malformed slug', 'products?category=Bad%20Slug', 400],
    ['a limit too large', 'products?limit=500', 400],
    ['an unknown product', 'products/no-such-product-anywhere', 404],
    ['a malformed product slug', 'products/..%2F..%2Fetc', 400],
  ])('refuses %s', async (_name, path, status) => {
    expect((await store(path)).status).toBe(status);
  });

  it('is cacheable by browsers and the portal for a short time', async () => {
    expect((await store('products')).headers.get('cache-control')).toBe('public, max-age=30');
  });
});
