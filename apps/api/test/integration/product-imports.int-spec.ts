import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/bootstrap';
import { REMOTE_FILES } from '../../src/modules/catalogue/catalogue.module';
import type { RemoteFiles } from '../../src/modules/catalogue/application/ports';
import { StaffService } from '../../src/modules/identity';
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions';
import { ImportRunner } from '../../src/modules/product-imports/application/import-runner';
import { DomainError, Principal } from '../../src/shared-kernel';
import { verifiedStaffToken } from './staff-mfa';

const prisma = new PrismaClient();
const PASSWORD = 'a-long-enough-password';
let app: INestApplication;
let base: string;
let importer: string;
let runner: ImportRunner;
let downloads: string[];

interface Reply {
  status: number;
  body: any;
  text: string;
  headers: Headers;
}

async function call(method: string, path: string, options: { token?: string; body?: unknown; form?: FormData } = {}): Promise<Reply> {
  const response = await fetch(`${base}/v1/${path}`, {
    method,
    headers: {
      ...(options.form ? {} : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const text = await response.text();
  const json = response.headers.get('content-type')?.includes('json');
  return { status: response.status, body: json && text ? JSON.parse(text) : null, text, headers: response.headers };
}

async function staffToken(permissions: readonly string[]): Promise<string> {
  const staff = app.get(StaffService);
  const root: Principal = { accountId: randomUUID(), sessionId: randomUUID(), audience: 'admin', permissions: PERMISSIONS };
  const role = await staff.createRole(root, `role_${randomUUID()}`, permissions);
  const email = `staff_${randomUUID()}@example.com`;
  await staff.createStaff(root, email, PASSWORD, [role.id]);
  return verifiedStaffToken(call, email, PASSWORD);
}

/** A tiny valid PNG; the content differs per URL so each photo is stored separately. */
const png = (seed: string) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(seed)]);

async function upload(csv: string, mode = 'create_and_update', token = importer): Promise<Reply> {
  const form = new FormData();
  form.set('mode', mode);
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'products.csv');
  return call('POST', 'admin/product-imports', { token, form });
}

async function importAndRun(csv: string, mode = 'create_and_update') {
  const uploaded = await upload(csv, mode);
  expect(uploaded.status).toBe(201);
  const started = await call('POST', `admin/product-imports/${uploaded.body.id}/start`, { token: importer });
  expect(started.status).toBe(200);
  expect(started.body.status).toBe('queued');
  expect(await runner.runOnce()).toBe(true);
  return (await call('GET', `admin/product-imports/${uploaded.body.id}`, { token: importer })).body;
}

const tag = randomUUID().slice(0, 8);
const categoryName = `Import Phones ${tag}`;
const warehouseName = `Import warehouse ${tag}`;
const brandName = `Import Brand ${tag}`;
const HEADER = 'handle,name,description,category,brand,status,images,sku,option1_name,option1_value,price,sale_price,discount_percent,weight_grams,stock,warehouse,attr:screen_size';
const phone = `phone-${tag}`;
const SKU = (suffix: string) => `IMP-${tag}-${suffix}`.toUpperCase();

function firstFile(): string {
  return [
    HEADER,
    `${phone},Import Phone ${tag},"Great phone, long battery",${categoryName},${brandName},published,https://photos.example/${tag}/front.png | https://photos.example/${tag}/back.png,${SKU('128')},Storage,128 GB,"215,000",185000,,450,25,${warehouseName},6.5`,
    `${phone},,,,,,,${SKU('256')},Storage,256 GB,245000,,10,450,4,${warehouseName},`,
    `bad-${tag},Bad Product,,No Such Category ${tag},,published,,${SKU('BAD')},,,100,,,10,,,`,
    `nophoto-${tag},No Photo ${tag},,${categoryName},,published,https://photos.example/${tag}/broken.png,${SKU('NOPHOTO')},,,5000,,,100,3,${warehouseName},5`,
  ].join('\n');
}

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  await prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:' } } });
  runner = app.get(ImportRunner);
  // Photos never come from the internet in tests.
  downloads = [];
  const remote = app.get<RemoteFiles>(REMOTE_FILES);
  jest.spyOn(remote, 'download').mockImplementation(async (url: string) => {
    downloads.push(url);
    if (url.includes('broken')) throw new DomainError('media.download_failed', 'The photo address answered with HTTP 404');
    return png(url);
  });

  importer = await staffToken(['catalogue.manage', 'catalogue.import', 'inventory.manage']);
  const category = await call('POST', 'admin/categories', {
    token: importer,
    body: { name: categoryName, attributes: [{ key: 'screen_size', label: 'Screen size', type: 'number', required: true }] },
  });
  expect(category.status).toBe(201);
  const warehouse = await call('POST', 'admin/warehouses', {
    token: importer,
    body: { name: warehouseName, address: { line1: '1 Test Road', city: 'Ikeja', state: 'Lagos' } },
  });
  expect(warehouse.status).toBe(201);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('product import permissions', () => {
  it('needs catalogue.import, which catalogue.manage alone does not give', async () => {
    const manager = await staffToken(['catalogue.manage']);
    expect((await upload(firstFile(), 'create_and_update', manager)).status).toBe(403);
    expect((await call('GET', 'admin/product-imports/template', { token: manager })).status).toBe(403);
  });

  it('serves the template and column reference', async () => {
    const template = await call('GET', 'admin/product-imports/template', { token: importer });
    expect(template.status).toBe(200);
    expect(template.headers.get('content-type')).toContain('text/csv');
    expect(template.text).toContain('handle,name,description,category');
    const columns = await call('GET', 'admin/product-imports/columns', { token: importer });
    expect(columns.body.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['sku', 'price', 'sale_price', 'images', 'warehouse']));
  });
});

describe('importing a CSV file', () => {
  let jobId: string;

  it('checks the whole file first and changes nothing', async () => {
    const reply = await upload(firstFile());
    expect(reply.status).toBe(201);
    jobId = reply.body.id;
    expect(reply.body).toMatchObject({ status: 'validated', issues: [], summary: { rows: 4, products: 3, creates: 2 }, counts: { ready: 2, invalid: 1 } });
    expect(await prisma.product.findUnique({ where: { slug: phone } })).toBeNull();

    const invalid = await call('GET', `admin/product-imports/${jobId}/items?status=invalid`, { token: importer });
    expect(invalid.body).toEqual([
      expect.objectContaining({ handle: `bad-${tag}`, lines: [4], errors: [expect.objectContaining({ line: 4, field: 'category', message: expect.stringContaining('no category') })] }),
    ]);
    const ready = await call('GET', `admin/product-imports/${jobId}/items?status=ready`, { token: importer });
    expect(ready.body[0]).toMatchObject({ action: 'create', skus: [SKU('128'), SKU('256')], warnings: [expect.objectContaining({ field: 'brand' })] });
  });

  it('imports the products that passed: prices, discounts, photos, stock, on sale', async () => {
    const started = await call('POST', `admin/product-imports/${jobId}/start`, { token: importer });
    expect(started.status).toBe(200);
    expect((await call('POST', `admin/product-imports/${jobId}/start`, { token: importer })).status).toBe(422);
    expect(await runner.runOnce()).toBe(true);
    expect(await runner.runOnce()).toBe(false);

    const job = (await call('GET', `admin/product-imports/${jobId}`, { token: importer })).body;
    expect(job).toMatchObject({ status: 'completed', counts: { imported: 2, invalid: 1, ready: 0, failed: 0 } });

    const page = await call('GET', `store/products/${phone}`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ name: `Import Phone ${tag}`, description: 'Great phone, long battery', brand: { name: brandName }, availability: 'in_stock' });
    expect(page.body.attributes).toEqual([{ label: 'Screen size', value: '6.5' }]);
    expect(page.body.images).toHaveLength(2);
    expect(page.body.images[0]).toMatch(/^\/media\/[0-9a-f-]{36}\.png$/);
    const [small, large] = page.body.variants;
    expect(small.offer).toMatchObject({ price: { amountMinor: '18500000' }, compareAt: { amountMinor: '21500000' } });
    // 10% off 245,000, rounded to whole naira.
    expect(large.offer).toMatchObject({ price: { amountMinor: '22050000' }, compareAt: { amountMinor: '24500000' }, availability: 'low_stock', lowStockQuantity: 4 });

    const photo = await fetch(`${base}/v1/store${page.body.images[0]}`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/png');
    expect(photo.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${base}/v1/store/media/${randomUUID()}.png`)).status).toBe(404);
    expect((await fetch(`${base}/v1/store/media/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });

  it('keeps a product whose photos all failed as a draft, with a warning, priced and stocked', async () => {
    const items = (await call('GET', `admin/product-imports/${jobId}/items?status=imported`, { token: importer })).body;
    const noPhoto = items.find((item: { handle: string }) => item.handle === `nophoto-${tag}`);
    expect(noPhoto.warnings.map((w: { message: string }) => w.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('HTTP 404'), expect.stringContaining('Saved as a draft')]),
    );
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: `nophoto-${tag}` }, include: { variants: { include: { listings: true } } } });
    expect(product.status).toBe('draft');
    expect(product.variants[0]?.listings[0]).toMatchObject({ priceMinor: 500000n, status: 'draft' });
    expect((await call('GET', `store/products/nophoto-${tag}`)).status).toBe(404);
  });

  it('writes every problem to a downloadable report, safe to open in a spreadsheet', async () => {
    const report = await call('GET', `admin/product-imports/${jobId}/report`, { token: importer });
    expect(report.status).toBe(200);
    expect(report.headers.get('content-disposition')).toContain('products-problems.csv');
    expect(report.text).toContain(`4,bad-${tag},Bad Product,${SKU('BAD')},invalid,error,category`);
  });

  it('updates existing products when the same handles are imported again, without downloading photos twice', async () => {
    const downloaded = downloads.length;
    const csv = [
      HEADER,
      `${phone},Import Phone ${tag},,${categoryName},,published,,${SKU('128')},Storage,128 GB,199000,,,450,30,${warehouseName},`,
      `${phone},,,,,,,${SKU('256')},Storage,256 GB,245000,,10,450,4,${warehouseName},`,
      `${phone},,,,,,,${SKU('512')},Storage,512 GB,275000,,,450,2,${warehouseName},`,
    ].join('\n');
    const job = await importAndRun(csv);
    expect(job).toMatchObject({ status: 'completed', summary: { updates: 1, creates: 0 }, counts: { imported: 1 } });
    expect(downloads.length).toBe(downloaded);

    const page = (await call('GET', `store/products/${phone}`)).body;
    expect(page.description).toBe('Great phone, long battery');
    expect(page.images).toHaveLength(2);
    expect(page.variants.map((v: { sku: string }) => v.sku)).toEqual([SKU('128'), SKU('256'), SKU('512')]);
    expect(page.variants[0].offer).toMatchObject({ price: { amountMinor: '19900000' }, compareAt: null });
    expect(page.variants[1].offer).toMatchObject({ price: { amountMinor: '22050000' }, compareAt: { amountMinor: '24500000' } });

    const stock = await prisma.stockItem.findMany({ where: { warehouse: { name: warehouseName } }, select: { onHand: true, listingId: true } });
    expect(stock.map((s) => s.onHand).sort((a, b) => a - b)).toEqual([2, 3, 4, 30]);

    // The same file again changes nothing.
    const movements = await prisma.stockMovement.count({ where: { stockItem: { warehouse: { name: warehouseName } } } });
    await importAndRun(csv);
    expect(await prisma.stockMovement.count({ where: { stockItem: { warehouse: { name: warehouseName } } } })).toBe(movements);
  });

  it('leaves existing products alone in create-only mode', async () => {
    const reply = await upload(firstFile().replace('"215,000"', '999999'), 'create_only');
    expect(reply.body.counts).toMatchObject({ skipped: 2, ready: 0, invalid: 1 });
    expect((await call('POST', `admin/product-imports/${reply.body.id}/start`, { token: importer })).status).toBe(422);
  });

  it('refuses a SKU that belongs to another product', async () => {
    const csv = [HEADER, `other-${tag},Other ${tag},,${categoryName},,draft,,${SKU('128')},,,100,,,10,,,`].join('\n');
    const reply = await upload(csv);
    const [item] = (await call('GET', `admin/product-imports/${reply.body.id}/items`, { token: importer })).body;
    expect(item).toMatchObject({ status: 'invalid', errors: [expect.objectContaining({ field: 'sku', message: expect.stringContaining('another product') })] });
  });

  it('reports a file it cannot use, and will not start it', async () => {
    const reply = await upload('name,price\nX,100');
    expect(reply.status).toBe(201);
    expect(reply.body.issues[0].message).toContain('Missing required columns');
    expect((await call('POST', `admin/product-imports/${reply.body.id}/start`, { token: importer })).status).toBe(422);
    expect((await upload('')).status).toBe(422);
    const form = new FormData();
    form.set('file', new Blob(['{}']), 'products.json');
    expect((await call('POST', 'admin/product-imports', { token: importer, form })).status).toBe(422);
  });

  it('cancels a queued import before anything is applied', async () => {
    const csv = [HEADER, `cancel-${tag},Cancelled ${tag},,${categoryName},,draft,,${SKU('CANCEL')},,,100,,,10,,,`].join('\n');
    const reply = await upload(csv);
    await call('POST', `admin/product-imports/${reply.body.id}/start`, { token: importer });
    const cancelled = await call('POST', `admin/product-imports/${reply.body.id}/cancel`, { token: importer });
    expect(cancelled.body.status).toBe('cancelled');
    expect(await runner.runOnce()).toBe(false);
    expect(await prisma.product.findUnique({ where: { slug: `cancel-${tag}` } })).toBeNull();
    expect((await call('POST', `admin/product-imports/${reply.body.id}/cancel`, { token: importer })).status).toBe(422);
  });

  it('records who uploaded and started each import', async () => {
    const entries = await prisma.auditLog.findMany({ where: { targetType: 'product_import', targetId: jobId }, orderBy: { createdAt: 'asc' } });
    expect(entries.map((entry) => entry.action)).toEqual(['catalogue.import_uploaded', 'catalogue.import_started']);
  });
});
