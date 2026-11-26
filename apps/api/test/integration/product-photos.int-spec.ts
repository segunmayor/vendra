import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/bootstrap';
import { REMOTE_FILES } from '../../src/modules/catalogue/catalogue.module';
import type { RemoteFiles } from '../../src/modules/catalogue/application/ports';
import { StaffService } from '../../src/modules/identity';
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions';
import { DomainError, Principal } from '../../src/shared-kernel';
import { verifiedStaffToken } from './staff-mfa';


const prisma = new PrismaClient();
const PASSWORD = 'a-long-enough-password';
let app: INestApplication;
let base: string;
let manager: string;
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

const png = (seed: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(seed)]);

function photoForm(bytes: Uint8Array, name = 'photo.png'): FormData {
  const form = new FormData();
  form.set('file', new Blob([bytes]), name);
  return form;
}

const tag = randomUUID().slice(0, 8);

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  await prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:' } } });
  // Photos never come from the internet in tests.
  const remote = app.get<RemoteFiles>(REMOTE_FILES);
  jest.spyOn(remote, 'download').mockImplementation(async (url: string) => {
    if (url.includes('page')) return new Uint8Array(Buffer.from('<!doctype html><html></html>'));
    return png(url);
  });

  manager = await staffToken(['catalogue.manage']);
  const category = await call('POST', 'admin/categories', { token: manager, body: { name: `Photo Things ${tag}`, attributes: [] } });
  expect(category.status).toBe(201);
  const product = await call('POST', 'admin/products', {
    token: manager,
    body: { categoryId: category.body.id, name: `Photo Product ${tag}`, description: 'For photo tests', brandId: null, attributes: {} },
  });
  expect(product.status).toBe(201);
  expect(product.body.images).toEqual([]);
  productId = product.body.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('product photos', () => {
  it('needs catalogue.manage', async () => {
    const outsider = await staffToken(['orders.manage']);
    expect((await call('POST', `admin/products/${productId}/images`, { token: outsider, form: photoForm(png('x')) })).status).toBe(403);
    expect((await call('PUT', `admin/products/${productId}/images`, { token: outsider, body: { images: [] } })).status).toBe(403);
  });

  it('uploads a photo, checks it by content, and serves it', async () => {
    const reply = await call('POST', `admin/products/${productId}/images`, { token: manager, form: photoForm(png(`upload-${tag}`)) });
    expect(reply.status).toBe(200);
    expect(reply.body.images).toHaveLength(1);
    const [image] = reply.body.images as string[];
    expect(image).toMatch(/^\/media\/[0-9a-f-]{36}\.png$/);

    const served = await fetch(`${base}/v1/store${image}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');

    const audit = await prisma.auditLog.findFirst({ where: { targetId: productId, action: 'catalogue.product_images_set' } });
    expect(audit).not.toBeNull();
  });

  it('refuses files that are not photos, whatever their name', async () => {
    const svg = await call('POST', `admin/products/${productId}/images`, {
      token: manager,
      form: photoForm(new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), 'photo.png'),
    });
    expect(svg.status).toBe(422);
    expect(svg.body.code).toBe('media.not_an_image');
    expect((await call('POST', `admin/products/${productId}/images`, { token: manager, form: new FormData() })).body.code).toBe('media.no_file');
  });

  it('adds a photo from a web address, and refuses unsafe or wrong addresses', async () => {
    const added = await call('POST', `admin/products/${productId}/images/from-url`, { token: manager, body: { url: `https://photos.example/${tag}/side.png` } });
    expect(added.status).toBe(200);
    expect(added.body.images).toHaveLength(2);

    const insecure = await call('POST', `admin/products/${productId}/images/from-url`, { token: manager, body: { url: 'http://photos.example/a.png' } });
    expect(insecure.body.code).toBe('media.insecure_url');
    const page = await call('POST', `admin/products/${productId}/images/from-url`, { token: manager, body: { url: `https://photos.example/${tag}/page` } });
    expect(page.body.code).toBe('media.not_an_image');
  });

  it('reorders and removes photos, but never adds through the arrange call', async () => {
    const current = (await call('GET', `admin/products/${productId}`, { token: manager })).body.images as string[];
    const reversed = [...current].reverse();
    const reordered = await call('PUT', `admin/products/${productId}/images`, { token: manager, body: { images: reversed } });
    expect(reordered.status).toBe(200);
    expect(reordered.body.images).toEqual(reversed);

    const sneaky = await call('PUT', `admin/products/${productId}/images`, { token: manager, body: { images: [...reversed, 'https://elsewhere.example/x.png'] } });
    expect(sneaky.status).toBe(422);
    expect(sneaky.body.code).toBe('product.unknown_image');

    const removed = await call('PUT', `admin/products/${productId}/images`, { token: manager, body: { images: [reversed[0]] } });
    expect(removed.body.images).toEqual([reversed[0]]);
  });

  it('stops at the most photos a product may have', async () => {
    for (let index = 0; index < 9; index++) {
      const reply = await call('POST', `admin/products/${productId}/images`, { token: manager, form: photoForm(png(`many-${tag}-${index}`)) });
      expect(reply.status).toBe(200);
    }
    const full = await call('POST', `admin/products/${productId}/images`, { token: manager, form: photoForm(png(`one-too-many-${tag}`)) });
    expect(full.status).toBe(422);
    expect(full.body.code).toBe('product.too_many_images');
  });
});
