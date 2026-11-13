import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/bootstrap';
import { StaffService } from '../../src/modules/identity';
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions';
import { Principal } from '../../src/shared-kernel';
import { verifiedStaffToken } from './staff-mfa';

const prisma = new PrismaClient();
const PASSWORD = 'a-long-enough-password';
let app: INestApplication;
let base: string;
let reviewer: string;

interface Reply {
  status: number;
  body: any;
  headers: Headers;
}

async function call(method: string, path: string, options: { token?: string; body?: unknown; form?: FormData } = {}): Promise<Reply> {
  const response = await fetch(`${base}/v1/${path}`, {
    method,
    headers: { ...(options.form ? {} : { 'content-type': 'application/json' }), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
    body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, body, headers: response.headers };
}
const ok = (reply: Reply, status = 200) => {
  expect({ status: reply.status, body: reply.body }).toMatchObject({ status });
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

async function vendor(): Promise<{ token: string; email: string }> {
  const email = `seller_${randomUUID()}@example.ng`;
  return { token: ok(await call('POST', 'vendor/auth/register', { body: { email, password: PASSWORD } }), 201).accessToken, email };
}

/** A different random number per run, so duplicate-number checks only see this run's rows. */
const rcNumber = () => `RC${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
const details = (over: Record<string, unknown> = {}) => ({
  displayName: 'Ada Kitchens',
  legalName: 'Ada Kitchens Limited',
  businessKind: 'company',
  registrationNumber: rcNumber(),
  phone: '0803 123 4567',
  address: { line1: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos' },
  ...over,
});

const PDF = Buffer.from('%PDF-1.7\n% test certificate\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function upload(token: string, kind: string, content: Buffer, name: string, type = 'application/pdf') {
  const form = new FormData();
  form.set('kind', kind);
  form.set('file', new Blob([content], { type }), name);
  return call('POST', 'vendor/application/documents', { token, form });
}

async function configure(values: Record<string, unknown>) {
  ok(await call('PUT', 'admin/settings', { token: reviewer, body: { values } }), 204);
}

const VENDOR_SETTINGS = ['vendors.applicationsOpen', 'vendors.requireRegistrationCertificate', 'vendors.requireOwnerId', 'vendors.requireProofOfAddress', 'vendors.requireTaxCertificate', 'vendors.maxDocumentMb'];

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
  await prisma.setting.deleteMany({ where: { key: { in: VENDOR_SETTINGS } } });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  await prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:' } } });
  reviewer = await staffToken(['vendors.approve', 'settings.manage']);
  // Two documents required for these tests: the certificate and the owner's ID.
  await configure({ 'vendors.requireProofOfAddress': false });
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { in: VENDOR_SETTINGS } } });
  await app.close();
  await prisma.$disconnect();
});

describe('seller applications', () => {
  it('goes from registration to approval, with documents checked, stored and downloadable', async () => {
    const seller = await vendor();
    const empty = ok(await call('GET', 'vendor/application', { token: seller.token }));
    expect(empty).toMatchObject({ application: null, requirements: { open: true, requiredDocuments: ['registration_certificate', 'owner_id'], maxDocumentBytes: 5 * 1024 * 1024 } });

    const number = rcNumber();
    const saved = ok(await call('PUT', 'vendor/application', { token: seller.token, body: details({ registrationNumber: number.replace('RC', 'rc ') }) }));
    expect(saved).toMatchObject({ status: 'draft', profile: { registrationNumber: number, phone: '+2348031234567' }, missingDocuments: ['registration_certificate', 'owner_id'], version: 1 });

    const cert = ok(await upload(seller.token, 'registration_certificate', PDF, 'CAC certificate.pdf'));
    expect(cert.documents).toEqual([expect.objectContaining({ kind: 'registration_certificate', fileName: 'CAC certificate.pdf', contentType: 'application/pdf', sizeBytes: PDF.length })]);
    // A file whose name says PDF but whose content is a photo is stored as what it is.
    const id = ok(await upload(seller.token, 'owner_id', PNG, 'passport.pdf', 'application/pdf'));
    expect(id.documents[1]).toMatchObject({ fileName: 'passport.png', contentType: 'image/png' });
    expect(id.missingDocuments).toEqual([]);

    const submitted = ok(await call('POST', 'vendor/application/submit', { token: seller.token, body: { version: id.version } }));
    expect(submitted).toMatchObject({ status: 'pending_verification', editable: false });
    expect(await upload(seller.token, 'other', PDF, 'late.pdf')).toMatchObject({ status: 422, body: { code: 'seller.not_editable' } });

    const waiting = ok(await call('GET', 'admin/sellers?status=pending_verification', { token: reviewer }));
    expect(waiting.map((entry: { id: string }) => entry.id)).toContain(submitted.id);
    const counts = ok(await call('GET', 'admin/sellers/counts', { token: reviewer }));
    expect(counts.pending_verification).toBeGreaterThanOrEqual(1);

    const detail = ok(await call('GET', `admin/sellers/${submitted.id}`, { token: reviewer }));
    expect(detail).toMatchObject({ ownerEmail: seller.email, cases: [{ status: 'submitted', documents: [{ kind: 'registration_certificate' }, { kind: 'owner_id' }] }], sameRegistration: [] });

    const file = await call('GET', `admin/sellers/${submitted.id}/documents/${cert.documents[0].id}`, { token: reviewer });
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.body, PDF)).toBe(0);
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="CAC certificate.pdf"/);
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    const own = await call('GET', `vendor/application/documents/${id.documents[1].id}`, { token: seller.token });
    expect(Buffer.compare(own.body, PNG)).toBe(0);

    const approved = ok(await call('POST', `admin/sellers/${submitted.id}/review`, { token: reviewer, body: { decision: 'approve', version: detail.version } }));
    expect(approved).toMatchObject({ status: 'active', decision: { status: 'approved' } });
    expect(ok(await call('GET', 'vendor/application', { token: seller.token })).application).toMatchObject({ status: 'active', decision: { status: 'approved' } });

    const stored = await prisma.sellerDocument.findMany({ where: { sellerId: submitted.id }, orderBy: { uploadedAt: 'asc' } });
    expect(stored.map((row) => [row.kind, row.sizeBytes, row.sha256.length])).toEqual([
      ['registration_certificate', PDF.length, 64],
      ['owner_id', PNG.length, 64],
    ]);
    const audits = await prisma.auditLog.findMany({ where: { targetType: 'seller', targetId: submitted.id }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((row) => row.action)).toEqual(['sellers.details_saved', 'sellers.document_added', 'sellers.document_added', 'sellers.submitted', 'sellers.reviewed']);
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: submitted.id }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((row) => row.type)).toEqual(['SellerApplicationSubmitted', 'SellerApproved']);
  });

  it('asks for changes with a reason, keeps the first submission, and takes a resubmission', async () => {
    const seller = await vendor();
    const draft = ok(await call('PUT', 'vendor/application', { token: seller.token, body: details() }));
    const cert = ok(await upload(seller.token, 'registration_certificate', PDF, 'cac.pdf'));
    const blurry = ok(await upload(seller.token, 'owner_id', PNG, 'id.png', 'image/png'));
    ok(await call('POST', 'vendor/application/submit', { token: seller.token, body: {} }));

    const noReason = await call('POST', `admin/sellers/${draft.id}/review`, { token: reviewer, body: { decision: 'request_changes' } });
    expect(noReason.status).toBe(400);
    ok(await call('POST', `admin/sellers/${draft.id}/review`, { token: reviewer, body: { decision: 'request_changes', note: 'The ID photo is blurred. Upload a clearer one.' } }));

    const mine = ok(await call('GET', 'vendor/application', { token: seller.token })).application;
    expect(mine).toMatchObject({ status: 'changes_requested', editable: true, decision: { note: 'The ID photo is blurred. Upload a clearer one.' } });
    const removed = ok(await call('DELETE', `vendor/application/documents/${blurry.documents[1].id}`, { token: seller.token }));
    expect(removed.missingDocuments).toEqual(['owner_id']);
    await expect(call('POST', 'vendor/application/submit', { token: seller.token, body: {} })).resolves.toMatchObject({ status: 422, body: { code: 'seller.documents_missing' } });
    ok(await upload(seller.token, 'owner_id', PNG, 'id-clear.png', 'image/png'));
    ok(await call('POST', 'vendor/application/submit', { token: seller.token, body: {} }));

    const detail = ok(await call('GET', `admin/sellers/${draft.id}`, { token: reviewer }));
    expect(detail.cases.map((entry: { status: string; documents: { fileName: string }[] }) => [entry.status, entry.documents.map((d) => d.fileName)])).toEqual([
      ['submitted', ['cac.pdf', 'id-clear.png']],
      ['changes_requested', ['cac.pdf', 'id.png']],
    ]);
    // The removed file is still available to staff, as part of the first submission.
    expect((await call('GET', `admin/sellers/${draft.id}/documents/${blurry.documents[1].id}`, { token: reviewer })).status).toBe(200);
    expect(cert.documents[0].id).toBe(detail.cases[0].documents[0].id);

    const rejected = ok(await call('POST', `admin/sellers/${draft.id}/review`, { token: reviewer, body: { decision: 'reject', note: 'The CAC record does not match this business.', version: detail.version } }));
    expect(rejected.status).toBe('rejected');
    const again = await call('PUT', 'vendor/application', { token: seller.token, body: details() });
    expect(again).toMatchObject({ status: 422, body: { code: 'seller.not_editable' } });
  });

  it('refuses unsafe or oversized files and missing details', async () => {
    const seller = await vendor();
    expect(await upload(seller.token, 'owner_id', PNG, 'id.png')).toMatchObject({ status: 404, body: { code: 'seller.not_found' } });
    ok(await call('PUT', 'vendor/application', { token: seller.token, body: details() }));
    expect(await upload(seller.token, 'other', Buffer.from('<html><script>alert(1)</script>'), 'page.pdf')).toMatchObject({ status: 422, body: { code: 'seller.document_type' } });
    expect(await upload(seller.token, 'other', Buffer.alloc(0), 'empty.pdf')).toMatchObject({ status: 422 });
    expect(await upload(seller.token, 'passport', PDF, 'a.pdf')).toMatchObject({ status: 400 });

    await configure({ 'vendors.maxDocumentMb': 1 });
    const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024)]);
    expect(await upload(seller.token, 'other', big, 'big.pdf')).toMatchObject({ status: 422, body: { code: 'seller.document_too_large' } });
    const huge = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload(seller.token, 'other', huge, 'huge.pdf')).status).toBe(413);
    await configure({ 'vendors.maxDocumentMb': 5 });

    for (const [change, code] of [
      [{ registrationNumber: 'ABC' }, 'seller.invalid_registration_number'],
      [{ phone: '12345' }, 'seller.invalid_phone'],
      [{ address: { line1: '1 Road', city: 'Ikeja', state: 'Texas' } }, 'seller.invalid_state'],
    ] as const) {
      expect(await call('PUT', 'vendor/application', { token: seller.token, body: details(change) })).toMatchObject({ status: 422, body: { code } });
    }
  });

  it('flags a CAC number used by another application, and refuses a decision on an unseen change', async () => {
    const number = rcNumber();
    const first = await vendor();
    const second = await vendor();
    const one = ok(await call('PUT', 'vendor/application', { token: first.token, body: details({ registrationNumber: number }) }));
    ok(await call('PUT', 'vendor/application', { token: second.token, body: details({ registrationNumber: number, displayName: 'Copy Kitchens' }) }));
    await configure({ 'vendors.requireRegistrationCertificate': false, 'vendors.requireOwnerId': false });
    const submitted = ok(await call('POST', 'vendor/application/submit', { token: first.token, body: {} }));
    await configure({ 'vendors.requireRegistrationCertificate': true, 'vendors.requireOwnerId': true });

    const detail = ok(await call('GET', `admin/sellers/${one.id}`, { token: reviewer }));
    expect(detail.sameRegistration).toEqual([expect.objectContaining({ displayName: 'Copy Kitchens', status: 'draft' })]);
    expect(await call('POST', `admin/sellers/${one.id}/review`, { token: reviewer, body: { decision: 'approve', version: submitted.version - 1 } })).toMatchObject({ status: 409, body: { code: 'seller.changed' } });
    expect(await call('PUT', 'vendor/application', { token: second.token, body: { ...details(), version: 99 } })).toMatchObject({ status: 409 });
  });

  it('closes new applications when staff turn them off', async () => {
    await configure({ 'vendors.applicationsOpen': false });
    const seller = await vendor();
    expect(ok(await call('GET', 'vendor/application', { token: seller.token })).requirements.open).toBe(false);
    expect(await call('PUT', 'vendor/application', { token: seller.token, body: details() })).toMatchObject({ status: 403, body: { code: 'seller.applications_closed' } });
    await configure({ 'vendors.applicationsOpen': true });
  });

  it('keeps applicants, customers and other staff out of what is not theirs', async () => {
    const seller = await vendor();
    const other = await vendor();
    const mine = ok(await call('PUT', 'vendor/application', { token: seller.token, body: details() }));
    const file = ok(await upload(seller.token, 'other', PDF, 'mine.pdf'));
    ok(await call('PUT', 'vendor/application', { token: other.token, body: details() }));
    expect((await call('GET', `vendor/application/documents/${file.documents[0].id}`, { token: other.token })).status).toBe(404);
    expect((await call('DELETE', `vendor/application/documents/${file.documents[0].id}`, { token: other.token })).status).toBe(422);
    expect((await call('GET', 'admin/sellers', { token: seller.token })).status).toBe(401);

    const shopper = ok(await call('POST', 'store/auth/register', { body: { email: `shop_${randomUUID()}@example.ng`, password: PASSWORD } }), 201).accessToken;
    expect((await call('GET', 'vendor/application', { token: shopper })).status).toBe(401);
    const clerk = await staffToken(['orders.manage']);
    expect((await call('GET', `admin/sellers/${mine.id}`, { token: clerk })).status).toBe(403);
    expect((await call('POST', `admin/sellers/${mine.id}/review`, { token: clerk, body: { decision: 'approve' } })).status).toBe(403);
    // Vendra's own seller is never shown as an application.
    expect((await call('GET', 'admin/sellers/00000000-0000-4000-8000-000000000001', { token: reviewer })).status).toBe(404);
  });
});
