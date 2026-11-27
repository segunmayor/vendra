import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/bootstrap';
import { StaffService } from '../../src/modules/identity';
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions';
import type { DriverFactory, StorageDriver } from '../../src/modules/storage/application/ports';
import { StorageUnavailable } from '../../src/modules/storage/application/ports';
import { STORAGE_DRIVERS } from '../../src/modules/storage/storage.module';
import { Principal } from '../../src/shared-kernel';
import { verifiedStaffToken } from './staff-mfa';

const prisma = new PrismaClient();
const PASSWORD = 'a-long-enough-password';
const SETTINGS = ['media.maxVideoMb', 'media.maxVideosPerProduct'];
let app: INestApplication;
let base: string;
let manager: string;
let productId: string;
let slug: string;

interface Reply {
  status: number;
  body: any;
  text: string;
  headers: Headers;
}

async function call(method: string, path: string, options: { token?: string; body?: unknown; form?: FormData; headers?: Record<string, string> } = {}): Promise<Reply> {
  const response = await fetch(`${base}/v1/${path}`, {
    method,
    headers: { ...(options.form ? {} : { 'content-type': 'application/json' }), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...options.headers },
    body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const json = response.headers.get('content-type')?.includes('json');
  return { status: response.status, body: json && bytes.length ? JSON.parse(bytes.toString('utf8')) : bytes, text: bytes.toString('utf8'), headers: response.headers };
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

/** A small MP4-looking file: the ftyp box, then random bytes so each one is distinct. */
const mp4 = (size = 20_000) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(12), randomBytes(size)]);

function videoForm(bytes: Buffer, name = 'clip.mp4') {
  const form = new FormData();
  form.set('file', new Blob([bytes]), name);
  return form;
}

const upload = (bytes: Buffer, name?: string, token = manager) => call('POST', `admin/products/${productId}/videos`, { token, form: videoForm(bytes, name) });
const settings = (values: Record<string, unknown>) => call('PUT', 'admin/settings', { token: manager, body: { values } });
const tag = randomUUID().slice(0, 8);

/** A storage service without ranged reads, so the whole-file fallback is used too. */
class MemoryBucket implements StorageDriver {
  readonly files = new Map<string, Uint8Array>();
  async put(key: string, content: Uint8Array) {
    this.files.set(key, new Uint8Array(content));
  }
  async get(key: string) {
    const file = this.files.get(key);
    if (!file) throw new StorageUnavailable('missing');
    return file;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
  await prisma.setting.deleteMany({ where: { key: { in: SETTINGS } } });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  await prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:' } } });
  const bucket = new MemoryBucket();
  jest.spyOn(app.get<DriverFactory>(STORAGE_DRIVERS), 'create').mockImplementation(() => bucket);

  manager = await staffToken(['catalogue.manage', 'settings.manage']);
  const category = ok(await call('POST', 'admin/categories', { token: manager, body: { name: `Video Things ${tag}`, attributes: [] } }), 201);
  const product = ok(await call('POST', 'admin/products', { token: manager, body: { categoryId: category.id, name: `Video Product ${tag}`, description: 'x', brandId: null, attributes: {} } }), 201);
  productId = product.id;
  slug = product.slug;
  expect(product.videos).toEqual([]);
  const variant = ok(await call('POST', `admin/products/${productId}/variants`, { token: manager, body: { sku: `VID-${tag}`.toUpperCase(), weightGrams: 100, options: {} } }), 201);
  ok(await call('POST', `admin/products/${productId}/publish`, { token: manager }));
  const listing = ok(await call('POST', 'admin/listings', { token: manager, body: { variantId: variant.id, priceMinor: '500000', currency: 'NGN' } }), 201);
  ok(await call('POST', `admin/listings/${listing.id}/activate`, { token: manager }));
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { in: SETTINGS } } });
  await prisma.storageLocation.updateMany({ where: { active: true }, data: { active: false } });
  await app.close();
  await prisma.$disconnect();
});

describe('product videos', () => {
  let first: string;
  let firstBytes: Buffer;

  it('needs catalogue.manage', async () => {
    const outsider = await staffToken(['orders.manage']);
    expect((await upload(mp4(), 'clip.mp4', outsider)).status).toBe(403);
  });

  it('uploads a video, checked by its content, and plays it in ranges', async () => {
    firstBytes = mp4(50_000);
    const product = ok(await upload(firstBytes));
    expect(product.videos).toHaveLength(1);
    first = product.videos[0];
    expect(first).toMatch(/^\/media\/[0-9a-f-]{36}\.mp4$/);

    const whole = await call('GET', `store${first}`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.compare(whole.body, firstBytes)).toBe(0);

    const part = await call('GET', `store${first}`, { headers: { range: 'bytes=100-199' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 100-199/${firstBytes.length}`);
    expect(Buffer.compare(part.body, firstBytes.subarray(100, 200))).toBe(0);

    const tail = await call('GET', `store${first}`, { headers: { range: 'bytes=-10' } });
    expect(Buffer.compare(tail.body, firstBytes.subarray(firstBytes.length - 10))).toBe(0);

    const past = await call('GET', `store${first}`, { headers: { range: `bytes=${firstBytes.length}-` } });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe(`bytes */${firstBytes.length}`);

    const audit = await prisma.auditLog.findFirst({ where: { targetId: productId, action: 'catalogue.product_videos_set' } });
    expect(audit).not.toBeNull();
  });

  it('refuses files that are not videos, whatever they are called', async () => {
    const fake = await upload(Buffer.from('<html>definitely not a video</html>'), 'clip.mp4');
    expect(fake.status).toBe(422);
    expect(fake.body.code).toBe('media.not_a_video');
  });

  it('follows the limits set in Settings', async () => {
    expect((await settings({ 'media.maxVideoMb': 1 })).status).toBe(204);
    const big = await upload(mp4(1024 * 1024 + 10));
    expect(big.status).toBe(422);
    expect(big.body.detail).toBe('Videos can be up to 1 MB');

    expect((await settings({ 'media.maxVideosPerProduct': 1 })).status).toBe(204);
    expect((await upload(mp4())).body.code).toBe('product.too_many_videos');
    expect((await settings({ 'media.maxVideosPerProduct': 0 })).status).toBe(204);
    expect((await upload(mp4())).body.code).toBe('product.videos_off');
    // Back to the defaults (through the API, so its settings cache sees it).
    expect((await settings({ 'media.maxVideoMb': 50, 'media.maxVideosPerProduct': 3 })).status).toBe(204);
    // The public settings tell Admin the limits.
    const values = ok(await call('GET', 'store/settings')).values;
    expect(values).toMatchObject({ 'media.maxVideoMb': 50, 'media.maxVideosPerProduct': 3 });
  });

  it('keeps videos in a storage location when one is active, and still plays them in ranges', async () => {
    const location = ok(
      await call('POST', 'admin/storage/locations', {
        token: manager,
        body: { type: 's3_compatible', name: `Videos ${tag}`, config: { endpoint: 'https://videos.example.test', bucket: 'vendra-videos', prefix: `v-${tag}` }, credentials: { accessKeyId: 'AKIA-VIDEO', secretAccessKey: 'video-secret-1234' } },
      }),
      201,
    );
    ok(await call('POST', `admin/storage/locations/${location.id}/activate`, { token: manager }));
    const bytes = mp4(30_000);
    const product = ok(await upload(bytes, 'second.mov'));
    const second = product.videos[1] as string;
    const media = await prisma.productMedia.findUniqueOrThrow({ where: { id: second.match(/([0-9a-f-]{36})/)![1]! } });
    expect(media.content).toBeNull();
    expect((await prisma.storageObject.findUniqueOrThrow({ where: { id: media.storageObjectId! } })).key).toMatch(new RegExp(`^v-${tag}/product-media/.+\\.mp4$`));

    const part = await call('GET', `store${second}`, { headers: { range: 'bytes=0-63' } });
    expect(part.status).toBe(206);
    expect(Buffer.compare(part.body, bytes.subarray(0, 64))).toBe(0);
    ok(await call('POST', 'admin/storage/database/activate', { token: manager }), 204);
  });

  it('shows videos on the product page in the Store, in order', async () => {
    const page = ok(await call('GET', `store/products/${slug}`));
    expect(page.videos).toHaveLength(2);
    expect(page.videos[0]).toBe(first);
  });

  it('reorders and removes videos, but never adds through the arrange call', async () => {
    const current = ok(await call('GET', `admin/products/${productId}`, { token: manager })).videos as string[];
    const reversed = [...current].reverse();
    expect(ok(await call('PUT', `admin/products/${productId}/videos`, { token: manager, body: { videos: reversed } })).videos).toEqual(reversed);
    const sneaky = await call('PUT', `admin/products/${productId}/videos`, { token: manager, body: { videos: [...reversed, `/media/${randomUUID()}.mp4`] } });
    expect(sneaky.body.code).toBe('product.unknown_video');
    expect(ok(await call('PUT', `admin/products/${productId}/videos`, { token: manager, body: { videos: [] } })).videos).toEqual([]);
  });
});
