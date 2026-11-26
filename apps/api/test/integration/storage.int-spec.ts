import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/bootstrap';
import { StaffService } from '../../src/modules/identity';
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions';
import type { DriverFactory, StorageDriver } from '../../src/modules/storage/application/ports';
import { StorageUnavailable } from '../../src/modules/storage/application/ports';
import { StorageMoveRunner } from '../../src/modules/storage/application/moves';
import { PUBLIC_FETCHER, STORAGE_DRIVERS } from '../../src/modules/storage/storage.module';
import type { PublicFetcher } from '../../src/modules/storage/application/ports';
import { Principal } from '../../src/shared-kernel';
import { verifiedStaffToken } from './staff-mfa';

const prisma = new PrismaClient();
const PASSWORD = 'a-long-enough-password';
let app: INestApplication;
let base: string;
let admin: string;
let productId: string;

interface Reply {
  status: number;
  body: any;
  text: string;
  headers: Headers;
}

async function call(method: string, path: string, options: { token?: string; body?: unknown; form?: FormData } = {}): Promise<Reply> {
  const response = await fetch(`${base}/v1/${path}`, {
    method,
    headers: { ...(options.form ? {} : { 'content-type': 'application/json' }), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
    body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString('utf8');
  const json = response.headers.get('content-type')?.includes('json');
  return { status: response.status, body: json && text ? JSON.parse(text) : bytes, text, headers: response.headers };
}

const ok = (reply: Reply, status = 200) => {
  expect({ status: reply.status, body: reply.status === status ? undefined : reply.body }).toEqual({ status, body: undefined });
  return reply.body;
};

async function staffToken(permissions: readonly string[]): Promise<string> {
  const staff = app.get(StaffService);
  const root: Principal = { accountId: randomUUID(), sessionId: randomUUID(), audience: 'admin', permissions: PERMISSIONS };
  const role = await staff.createRole(root, `role_${randomUUID()}`, permissions);
  const email = `staff_${randomUUID()}@example.com`;
  await staff.createStaff(root, email, PASSWORD, [role.id]);
  return verifiedStaffToken(call, email, PASSWORD);
}

/** Stands in for S3, Azure and MEGA: files live in memory, and a test can make it fail. */
class MemoryBucket implements StorageDriver {
  readonly files = new Map<string, Uint8Array>();
  failWith: string | null = null;
  async put(key: string, content: Uint8Array) {
    if (this.failWith) throw new StorageUnavailable(this.failWith);
    this.files.set(key, new Uint8Array(content));
  }
  async get(key: string) {
    const file = this.files.get(key);
    if (!file) throw new StorageUnavailable('The file is not in the bucket.');
    return file;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

const bucket = new MemoryBucket();
/** A CDN in front of the memory bucket, exposing only product photos unless a test opens it all up. */
const CDN = 'https://cdn.vendra.test';
const cdn = { exposeEverything: false };
const created: { secrets: Record<string, string> }[] = [];
const png = (seed: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(seed)]);
const tag = randomUUID().slice(0, 8);

function photoForm(bytes: Uint8Array) {
  const form = new FormData();
  form.set('file', new Blob([bytes]), 'photo.png');
  return form;
}

const r2 = {
  type: 's3_compatible',
  name: `Photos on R2 ${tag}`,
  config: { endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'vendra-files', prefix: `shop-${tag}` },
  credentials: { accessKeyId: 'AKIA-TEST-ID', secretAccessKey: 'secret-for-tests-ZYXW' },
};

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
  // Files earlier runs left in in-memory buckets cannot be read any more: forget them, so moves
  // here only see files this run can read. Test database only (checked above).
  await prisma.productMedia.deleteMany({ where: { storageObjectId: { not: null } } });
  await prisma.sellerDocument.deleteMany({ where: { storageObjectId: { not: null } } });
  await prisma.storageMoveJob.deleteMany({});
  await prisma.storageObject.deleteMany({});
  await prisma.storageLocation.deleteMany({});
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  await prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:' } } });
  const drivers = app.get<DriverFactory>(STORAGE_DRIVERS);
  jest.spyOn(drivers, 'create').mockImplementation((_kind, _type, _config, secrets) => {
    created.push({ secrets: { ...secrets } });
    return bucket;
  });

  jest.spyOn(app.get<PublicFetcher>(PUBLIC_FETCHER), 'get').mockImplementation(async (url: string) => {
    const key = decodeURIComponent(url.slice(CDN.length + 1));
    const file = bucket.files.get(key);
    return file && (cdn.exposeEverything || key.includes('/product-media/')) ? { status: 200, body: file } : { status: 403, body: new Uint8Array() };
  });

  admin = await staffToken(['settings.manage', 'catalogue.manage']);
  const category = ok(await call('POST', 'admin/categories', { token: admin, body: { name: `Storage Things ${tag}`, attributes: [] } }), 201);
  productId = ok(await call('POST', 'admin/products', { token: admin, body: { categoryId: category.id, name: `Stored Product ${tag}`, description: 'x', brandId: null, attributes: {} } }), 201).id;
});

afterAll(async () => {
  // Other suites keep files in the database.
  await prisma.storageLocation.updateMany({ where: { active: true }, data: { active: false } });
  await app.close();
  await prisma.$disconnect();
});

describe('file storage locations', () => {
  let locationId: string;

  it('needs settings.manage', async () => {
    const outsider = await staffToken(['catalogue.manage']);
    expect((await call('GET', 'admin/storage/locations', { token: outsider })).status).toBe(403);
    expect((await call('POST', 'admin/storage/locations', { token: outsider, body: r2 })).status).toBe(403);
  });

  it('lists the services it can use', async () => {
    const types = ok(await call('GET', 'admin/storage/types', { token: admin }));
    expect(types.map((type: { type: string }) => type.type)).toEqual(['aws_s3', 's3_compatible', 'google_cloud', 'azure_blob', 'mega']);
    expect(types[0]).not.toHaveProperty('driver');
  });

  it('saves a location with encrypted credentials, never returned', async () => {
    const location = ok(await call('POST', 'admin/storage/locations', { token: admin, body: r2 }), 201);
    locationId = location.id;
    expect(location).toMatchObject({ active: false, lastCheck: null, secretHints: { accessKeyId: '••••T-ID', secretAccessKey: '••••ZYXW' } });
    const row = await prisma.storageLocation.findUniqueOrThrow({ where: { id: locationId } });
    expect(row.secrets).toMatch(/^v1:/);
    expect(row.secrets).not.toContain('secret-for-tests');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: locationId, action: 'storage.location_created' } });
    expect(JSON.stringify(audit.after)).not.toContain('secret-for-tests');
    expect(audit.after).toMatchObject({ credentialsChanged: ['accessKeyId', 'secretAccessKey'] });
  });

  it('refuses to make a failing location active, and records why', async () => {
    bucket.failWith = 'The bucket does not exist. Check its name, and the region or endpoint.';
    const refused = await call('POST', `admin/storage/locations/${locationId}/activate`, { token: admin });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'storage.check_failed' });
    expect(refused.body.detail).toContain('The bucket does not exist');
    const overview = ok(await call('GET', 'admin/storage/locations', { token: admin }));
    expect(overview.activeId).toBeNull();
    bucket.failWith = null;
  });

  it('tests a location with its saved credentials', async () => {
    const tested = ok(await call('POST', `admin/storage/locations/${locationId}/test`, { token: admin }));
    expect(tested.lastCheck).toMatchObject({ ok: true, message: null });
    expect(created.at(-1)!.secrets).toEqual(r2.credentials);
    expect(bucket.files.size).toBe(0);
  });

  it('sends new photos to the active location and serves them from there', async () => {
    const before = await call('POST', `admin/products/${productId}/images`, { token: admin, form: photoForm(png(`db-${tag}`)) });
    const inDatabase = (before.body.images as string[])[0]!;

    ok(await call('POST', `admin/storage/locations/${locationId}/activate`, { token: admin }));
    expect(ok(await call('GET', 'admin/storage/locations', { token: admin })).activeId).toBe(locationId);

    const after = ok(await call('POST', `admin/products/${productId}/images`, { token: admin, form: photoForm(png(`remote-${tag}`)) }));
    const remote = (after.images as string[])[1]!;
    const mediaId = remote.match(/([0-9a-f-]{36})/)![1]!;
    const media = await prisma.productMedia.findUniqueOrThrow({ where: { id: mediaId } });
    expect(media.content).toBeNull();
    const object = await prisma.storageObject.findUniqueOrThrow({ where: { id: media.storageObjectId! } });
    expect(object).toMatchObject({ locationId, purpose: 'product-media', contentType: 'image/png' });
    expect(object.key).toMatch(new RegExp(`^shop-${tag}/product-media/\\d{4}/\\d{2}/${object.id}\\.png$`));
    expect(bucket.files.has(object.key)).toBe(true);

    const served = await call('GET', `store${remote}`);
    expect(served.status).toBe(200);
    expect(Buffer.compare(served.body, Buffer.from(png(`remote-${tag}`)))).toBe(0);
    // A file stored before the switch is still read from the database.
    expect((await call('GET', `store${inDatabase}`)).status).toBe(200);

    const usage = ok(await call('GET', `admin/storage/locations/${locationId}`, { token: admin })).usage;
    expect(usage.files).toBeGreaterThanOrEqual(1);
  });

  it('keeps seller documents in the active location too, and downloads them from there', async () => {
    const email = `seller_${randomUUID()}@example.ng`;
    const seller = ok(await call('POST', 'vendor/auth/register', { body: { email, password: PASSWORD } }), 201).accessToken;
    ok(
      await call('PUT', 'vendor/application', {
        token: seller,
        body: {
          displayName: 'Stored Docs Ltd',
          legalName: 'Stored Docs Limited',
          businessKind: 'company',
          registrationNumber: `RC${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
          phone: '0803 123 4567',
          address: { line1: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos' },
        },
      }),
    );
    const pdf = Buffer.from(`%PDF-1.7\n% stored remotely ${tag}\n`);
    const form = new FormData();
    form.set('kind', 'registration_certificate');
    form.set('file', new Blob([pdf], { type: 'application/pdf' }), 'certificate.pdf');
    const uploaded = ok(await call('POST', 'vendor/application/documents', { token: seller, form }));
    const documentId = uploaded.documents[0].id as string;

    const row = await prisma.sellerDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.content).toBeNull();
    const object = await prisma.storageObject.findUniqueOrThrow({ where: { id: row.storageObjectId! } });
    expect(object).toMatchObject({ locationId, purpose: 'seller-documents', contentType: 'application/pdf' });
    expect(object.key).toMatch(/\/seller-documents\/.+\.pdf$/);
    // The person's file name never reaches the bucket.
    expect(object.key).not.toContain('certificate');

    const download = await call('GET', `vendor/application/documents/${documentId}`, { token: seller });
    expect(download.status).toBe(200);
    expect(Buffer.compare(download.body, pdf)).toBe(0);
  });

  it('reports a failed upload instead of quietly keeping the file on this server', async () => {
    bucket.failWith = 'The storage service took too long to answer. Try again.';
    const failed = await call('POST', `admin/products/${productId}/images`, { token: admin, form: photoForm(png(`fail-${tag}`)) });
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('storage.write_failed');
    expect(failed.body.detail).toContain(r2.name);
    bucket.failWith = null;
  });

  it('refuses new settings for the active location that fail their check', async () => {
    bucket.failWith = 'The secret access key does not match the access key ID.';
    const refused = await call('PUT', `admin/storage/locations/${locationId}`, {
      token: admin,
      body: { name: r2.name, config: r2.config, credentials: { secretAccessKey: 'wrong-secret-0000' } },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toContain('nothing was changed');
    bucket.failWith = null;
    const location = ok(await call('GET', `admin/storage/locations/${locationId}`, { token: admin }));
    expect(location.secretHints.secretAccessKey).toBe('••••ZYXW');
  });

  it('protects a location that is active or holds files, and can go back to the database', async () => {
    expect((await call('DELETE', `admin/storage/locations/${locationId}`, { token: admin })).body.code).toBe('storage.in_use');
    ok(await call('POST', 'admin/storage/database/activate', { token: admin }), 204);
    expect(ok(await call('GET', 'admin/storage/locations', { token: admin })).activeId).toBeNull();
    expect((await call('DELETE', `admin/storage/locations/${locationId}`, { token: admin })).body.code).toBe('storage.has_files');

    const back = ok(await call('POST', `admin/products/${productId}/images`, { token: admin, form: photoForm(png(`back-${tag}`)) }));
    const mediaId = (back.images as string[]).at(-1)!.match(/([0-9a-f-]{36})/)![1]!;
    expect((await prisma.productMedia.findUniqueOrThrow({ where: { id: mediaId } })).content).not.toBeNull();
  });

  it('removes an empty, inactive location', async () => {
    const spare = ok(await call('POST', 'admin/storage/locations', { token: admin, body: { ...r2, name: `Spare ${tag}` } }), 201);
    ok(await call('DELETE', `admin/storage/locations/${spare.id}`, { token: admin }), 204);
    expect(await prisma.storageLocation.count({ where: { id: spare.id } })).toBe(0);
  });

  it('moves every file not yet in the active location into it, and checks each copy', async () => {
    const outsider = await staffToken(['catalogue.manage']);
    expect((await call('GET', 'admin/storage/moves/summary', { token: outsider })).status).toBe(403);

    // Files now in the database (this suite and others) and in the first location.
    const photo = ok(await call('POST', `admin/products/${productId}/images`, { token: admin, form: photoForm(png(`to-move-${tag}`)) }));
    const second = ok(await call('POST', 'admin/storage/locations', { token: admin, body: { ...r2, name: `Second bucket ${tag}`, config: { ...r2.config, prefix: `second-${tag}` } } }), 201);
    expect((await call('POST', 'admin/storage/moves', { token: admin, body: {} })).body.code).toBe('storage.no_active_location');
    ok(await call('POST', `admin/storage/locations/${second.id}/activate`, { token: admin }));

    const before = ok(await call('GET', 'admin/storage/moves/summary', { token: admin }));
    expect(before.activeId).toBe(second.id);
    expect(before.database.files).toBeGreaterThan(0);
    expect(before.otherLocations.files).toBeGreaterThanOrEqual(2);
    expect(before.running).toBeNull();

    expect((await call('POST', 'admin/storage/moves', { token: admin, body: { concurrency: 11 } })).status).toBe(400);
    const job = ok(await call('POST', 'admin/storage/moves', { token: admin, body: { deleteOld: true, concurrency: 3 } }), 201);
    expect(job).toMatchObject({ status: 'queued', total: before.database.files + before.otherLocations.files, deleteOld: true, concurrency: 3 });
    expect((await call('POST', 'admin/storage/moves', { token: admin, body: {} })).body.code).toBe('storage.move_running');
    expect(ok(await call('GET', 'admin/storage/moves/summary', { token: admin })).running.id).toBe(job.id);

    expect(await app.get(StorageMoveRunner).runOnce()).toBe(true);
    const done = ok(await call('GET', `admin/storage/moves/${job.id}`, { token: admin }));
    expect(done).toMatchObject({ status: 'completed', failed: 0, message: null, problems: [] });
    expect(done.moved).toBe(job.total);
    expect(done.movedBytes).toBeGreaterThan(0);

    const after = ok(await call('GET', 'admin/storage/moves/summary', { token: admin }));
    expect(after).toMatchObject({ database: { files: 0, bytes: 0 }, otherLocations: { files: 0, bytes: 0 }, running: null });
    expect(await prisma.productMedia.count({ where: { content: { not: null } } })).toBe(0);
    expect(await prisma.sellerDocument.count({ where: { content: { not: null } } })).toBe(0);

    // Every photo of the product, wherever it was before, is now read from the second bucket.
    for (const image of photo.images as string[]) {
      const media = await prisma.productMedia.findUniqueOrThrow({ where: { id: image.match(/([0-9a-f-]{36})/)![1]! } });
      expect((await prisma.storageObject.findUniqueOrThrow({ where: { id: media.storageObjectId! } })).locationId).toBe(second.id);
      expect((await call('GET', `store${image}`)).status).toBe(200);
    }
    expect([...bucket.files.keys()].some((key) => key.startsWith(`shop-${tag}/`))).toBe(false);

    // The first location no longer holds files in use, so it can be removed.
    ok(await call('DELETE', `admin/storage/locations/${locationId}`, { token: admin }), 204);
    expect((await call('POST', `admin/storage/moves/${job.id}/cancel`, { token: admin })).body.code).toBe('storage.move_finished');
    expect(await prisma.auditLog.count({ where: { targetId: job.id, action: 'storage.move_started' } })).toBe(1);
  });

  it('can be stopped before it runs', async () => {
    ok(await call('POST', 'admin/storage/database/activate', { token: admin }), 204);
    ok(await call('POST', `admin/products/${productId}/images`, { token: admin, form: photoForm(png(`later-${tag}`)) }));
    const target = ok(await call('GET', 'admin/storage/locations', { token: admin })).locations[0];
    ok(await call('POST', `admin/storage/locations/${target.id}/activate`, { token: admin }));
    const job = ok(await call('POST', 'admin/storage/moves', { token: admin, body: { deleteOld: false } }), 201);
    expect(job.concurrency).toBe(4);
    const stopped = ok(await call('POST', `admin/storage/moves/${job.id}/cancel`, { token: admin }));
    expect(stopped).toMatchObject({ status: 'cancelled' });
    expect(await app.get(StorageMoveRunner).runOnce()).toBe(false);
    expect(await prisma.productMedia.count({ where: { content: { not: null } } })).toBe(1);
  });

  it('serves product photos from a public address (CDN) once it passes its check, and never seller documents', async () => {
    const config = { ...r2.config, prefix: `cdn-${tag}`, publicDelivery: 'true', publicBaseUrl: CDN };

    cdn.exposeEverything = true;
    const exposed = await call('POST', 'admin/storage/locations', { token: admin, body: { ...r2, name: `Open CDN ${tag}`, config } });
    expect(exposed.status).toBe(422);
    expect(exposed.body.detail).toContain('Seller documents can be opened by anyone');
    cdn.exposeEverything = false;

    const location = ok(await call('POST', 'admin/storage/locations', { token: admin, body: { ...r2, name: `CDN ${tag}`, config } }), 201);
    expect(location.lastCheck).toMatchObject({ ok: true });
    ok(await call('POST', `admin/storage/locations/${location.id}/activate`, { token: admin }));

    const category = ok(await call('POST', 'admin/categories', { token: admin, body: { name: `CDN Things ${tag}`, attributes: [] } }), 201);
    const product = ok(await call('POST', 'admin/products', { token: admin, body: { categoryId: category.id, name: `CDN Product ${tag}`, description: 'x', brandId: null, attributes: {} } }), 201);
    const variant = ok(await call('POST', `admin/products/${product.id}/variants`, { token: admin, body: { sku: `CDN-${tag}`.toUpperCase(), weightGrams: 100, options: {} } }), 201);
    const withPhoto = ok(await call('POST', `admin/products/${product.id}/images`, { token: admin, form: photoForm(png(`cdn-${tag}`)) }));
    const path = (withPhoto.images as string[])[0]!;
    // Staff keep seeing the stable path; shoppers get the CDN address.
    expect(path).toMatch(/^\/media\//);
    ok(await call('POST', `admin/products/${product.id}/publish`, { token: admin }));
    const listing = ok(await call('POST', 'admin/listings', { token: admin, body: { variantId: variant.id, priceMinor: '500000', currency: 'NGN' } }), 201);
    ok(await call('POST', `admin/listings/${listing.id}/activate`, { token: admin }));

    const detail = ok(await call('GET', `store/products/${product.slug}`));
    const mediaId = path.match(/([0-9a-f-]{36})/)![1]!;
    const object = await prisma.storageObject.findUniqueOrThrow({ where: { id: (await prisma.productMedia.findUniqueOrThrow({ where: { id: mediaId } })).storageObjectId! } });
    expect(detail.images).toEqual([`${CDN}/${object.key}`]);

    const old = await fetch(`${base}/v1/store${path}`, { redirect: 'manual' });
    expect(old.status).toBe(302);
    expect(old.headers.get('location')).toBe(`${CDN}/${object.key}`);

    // When the CDN fails its check, photos go back through Vendra at once.
    cdn.exposeEverything = true;
    ok(await call('POST', `admin/storage/locations/${location.id}/test`, { token: admin }));
    cdn.exposeEverything = false;
    const after = await fetch(`${base}/v1/store${path}`, { redirect: 'manual' });
    expect(after.status).toBe(200);
    expect(ok(await call('GET', `store/products/${product.slug}`)).images).toEqual([path]);
    // Once a check passes again, the CDN is used again.
    ok(await call('POST', `admin/storage/locations/${location.id}/test`, { token: admin }));
    expect(ok(await call('GET', `store/products/${product.slug}`)).images).toEqual([`${CDN}/${object.key}`]);
  });
});

