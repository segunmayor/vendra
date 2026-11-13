import { ConcurrencyConflict, Principal } from '../../../shared-kernel';
import { SettingKey } from '../../settings';
import { SellerApplication, SellerApplicationState } from '../domain/seller-application';
import { SellerApplicationRepository } from './ports';
import { VendorsService } from './vendors.service';

const applicant: Principal = { accountId: 'acc1', sessionId: 's', audience: 'vendor', permissions: [] };
const reviewer: Principal = { accountId: 'staff1', sessionId: 's', audience: 'admin', permissions: ['vendors.approve'] };
const now = new Date('2026-11-13T09:00:00Z');
const pdf = new TextEncoder().encode('%PDF-1.7 certificate');
const details = {
  displayName: 'Ada Kitchens',
  legalName: 'Ada Kitchens Limited',
  businessKind: 'company' as const,
  registrationNumber: 'RC1234567',
  phone: '08031234567',
  address: { line1: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos' },
};

function setup(overrides: Partial<Record<SettingKey, unknown>> = {}) {
  const rows = new Map<string, SellerApplicationState>();
  const files = new Map<string, Uint8Array>();
  const audits: { action: string }[] = [];
  const events: { type: string }[] = [];
  const snapshot = (application: SellerApplication): SellerApplicationState => ({
    id: application.id,
    ownerAccountId: application.ownerAccountId,
    status: application.status,
    profile: application.profile,
    documents: application.allDocuments,
    cases: application.cases,
    createdAt: application.createdAt,
    version: application.version + 1,
  });
  const repo: SellerApplicationRepository = {
    findById: async (id) => (rows.has(id) ? SellerApplication.rehydrate(rows.get(id)!) : null),
    findByOwner: async (owner) => {
      const row = [...rows.values()].find((entry) => entry.ownerAccountId === owner);
      return row ? SellerApplication.rehydrate(row) : null;
    },
    list: async (status) => [...rows.values()].filter((row) => !status || row.status === status).map(SellerApplication.rehydrate),
    withRegistrationNumber: async (number, except) => [...rows.values()].filter((row) => row.profile.registrationNumber === number && row.id !== except).map(SellerApplication.rehydrate),
    countByStatus: async () => ({}),
    readDocument: async (_seller, id) => files.get(id) ?? null,
    save: async (application, audit, uploads = []) => {
      if ((rows.get(application.id)?.version ?? 0) !== application.version) throw new ConcurrencyConflict('Seller', application.id);
      for (const upload of uploads) files.set(upload.documentId, upload.content);
      events.push(...application.pullEvents());
      rows.set(application.id, snapshot(application));
      audits.push(audit);
      application.markSaved();
    },
  };
  const settings: Partial<Record<SettingKey, unknown>> = {
    'vendors.applicationsOpen': true,
    'vendors.requireRegistrationCertificate': true,
    'vendors.requireOwnerId': false,
    'vendors.requireProofOfAddress': false,
    'vendors.requireTaxCertificate': false,
    'vendors.maxDocumentMb': 5,
    'vendors.approvedMessage': 'Verified',
    ...overrides,
  };
  let next = 0;
  const service = new VendorsService(
    repo,
    { get: async (key) => settings[key] as never },
    { emailOf: async (id) => (id === 'acc1' ? 'ada@example.ng' : null) },
    { uuid: () => `id${++next}` },
    { now: () => now },
  );
  return { service, rows, audits, events, settings };
}

describe('VendorsService', () => {
  it('takes an application from details to approval, auditing each step', async () => {
    const world = setup();
    expect((await world.service.mine(applicant)).application).toBeNull();
    const saved = await world.service.saveDetails(applicant, details);
    expect(saved).toMatchObject({ status: 'draft', editable: true, missingDocuments: ['registration_certificate'], version: 1 });
    await expect(world.service.submit(applicant)).rejects.toThrow('CAC registration certificate');
    const withFile = await world.service.addDocument(applicant, { kind: 'registration_certificate', fileName: 'cac.pdf', content: pdf });
    expect(withFile.documents).toEqual([expect.objectContaining({ kind: 'registration_certificate', fileName: 'cac.pdf', contentType: 'application/pdf', sizeBytes: pdf.length })]);
    const submitted = await world.service.submit(applicant, withFile.version);
    expect(submitted).toMatchObject({ status: 'pending_verification', editable: false, submittedAt: now, decision: null });

    const staffView = await world.service.get(submitted.id);
    expect(staffView).toMatchObject({ ownerEmail: 'ada@example.ng', cases: [expect.objectContaining({ status: 'submitted', documents: [expect.objectContaining({ fileName: 'cac.pdf' })] })] });
    const file = await world.service.document(submitted.id, withFile.documents[0]!.id);
    expect(file).toMatchObject({ fileName: 'cac.pdf', contentType: 'application/pdf' });

    const approved = await world.service.review(reviewer, submitted.id, { decision: 'approve', version: staffView.version });
    expect(approved).toMatchObject({ status: 'active', decision: { status: 'approved', note: null } });
    expect(world.audits.map((entry) => entry.action)).toEqual(['sellers.details_saved', 'sellers.document_added', 'sellers.submitted', 'sellers.reviewed']);
    expect(world.events.map((event) => event.type)).toEqual(['SellerApplicationSubmitted', 'SellerApproved']);
  });

  it('refuses new applications when staff have closed them, but lets started ones continue', async () => {
    const world = setup();
    await world.service.saveDetails(applicant, details);
    world.settings['vendors.applicationsOpen'] = false;
    await expect(world.service.saveDetails({ ...applicant, accountId: 'acc2' }, details)).rejects.toThrow('not accepting');
    expect((await world.service.saveDetails(applicant, { ...details, displayName: 'Ada Kitchen' })).profile.displayName).toBe('Ada Kitchen');
    expect((await world.service.mine(applicant)).requirements.open).toBe(false);
  });

  it('refuses files that are too large or not documents', async () => {
    const world = setup({ 'vendors.maxDocumentMb': 1 });
    await world.service.saveDetails(applicant, details);
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(new TextEncoder().encode('%PDF-'));
    await expect(world.service.addDocument(applicant, { kind: 'other', fileName: 'a.pdf', content: big })).rejects.toThrow('up to 1 MB');
    await expect(world.service.addDocument(applicant, { kind: 'other', fileName: 'a.pdf', content: new TextEncoder().encode('MZ executable') })).rejects.toThrow('PDF, JPEG');
    await expect(setup().service.addDocument(applicant, { kind: 'other', fileName: 'a.pdf', content: pdf })).rejects.toThrow('saving your business details first');
  });

  it('refuses a decision on a version the reviewer has not seen, and flags a shared CAC number', async () => {
    const world = setup({ 'vendors.requireRegistrationCertificate': false });
    const first = await world.service.saveDetails(applicant, details);
    await world.service.submit(applicant);
    await world.service.saveDetails({ ...applicant, accountId: 'acc2' }, { ...details, displayName: 'Copycat' });
    const view = await world.service.get(first.id);
    expect(view.sameRegistration).toEqual([expect.objectContaining({ displayName: 'Copycat', status: 'draft' })]);
    await expect(world.service.review(reviewer, first.id, { decision: 'approve', version: view.version - 1 })).rejects.toThrow('changed elsewhere');
    await expect(world.service.saveDetails(applicant, details, 1)).rejects.toThrow('changed elsewhere');
  });

  it('shows the applicant the reason when changes are asked for, and lets them fix and resubmit', async () => {
    const world = setup({ 'vendors.requireRegistrationCertificate': false });
    const { id } = await world.service.saveDetails(applicant, details);
    await world.service.submit(applicant);
    await world.service.review(reviewer, id, { decision: 'request_changes', note: 'Use the name on your CAC certificate' });
    const mine = (await world.service.mine(applicant)).application!;
    expect(mine).toMatchObject({ status: 'changes_requested', editable: true, decision: { status: 'changes_requested', note: 'Use the name on your CAC certificate' } });
    await world.service.saveDetails(applicant, { ...details, legalName: 'Ada Kitchens Nigeria Limited' });
    const again = await world.service.submit(applicant);
    expect(again).toMatchObject({ status: 'pending_verification', decision: null });
    expect((await world.service.get(id)).cases.map((entry) => [entry.status, entry.profile.legalName])).toEqual([
      ['submitted', 'Ada Kitchens Nigeria Limited'],
      ['changes_requested', 'Ada Kitchens Limited'],
    ]);
  });
});
