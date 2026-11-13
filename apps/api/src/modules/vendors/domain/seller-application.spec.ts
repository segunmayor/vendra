import { checkDocumentFile } from './document-file';
import { parseProfile, ProfileInput, SellerApplication } from './seller-application';

const now = new Date('2026-11-13T09:00:00Z');
const input: ProfileInput = {
  displayName: ' Ada  Kitchens ',
  legalName: 'Ada Kitchens Limited',
  businessKind: 'company',
  registrationNumber: 'rc 123-4567',
  taxId: '12345678-0001',
  phone: '0803 123 4567',
  address: { line1: '12 Allen Avenue', city: 'Ikeja', state: 'Lagos' },
};

const doc = (id: string, kind: 'registration_certificate' | 'owner_id' | 'proof_of_address' | 'other') => ({
  id,
  kind,
  fileName: `${id}.pdf`,
  contentType: 'application/pdf',
  sizeBytes: 10,
  uploadedAt: now,
});

function started() {
  return SellerApplication.start({ id: 's1', ownerAccountId: 'acc1', profile: parseProfile(input), now });
}

describe('parseProfile', () => {
  it('tidies names, numbers and the phone', () => {
    expect(parseProfile(input)).toMatchObject({
      displayName: 'Ada Kitchens',
      registrationNumber: 'RC1234567',
      phone: '+2348031234567',
      taxId: '12345678-0001',
      address: { line1: '12 Allen Avenue', line2: null, city: 'Ikeja', state: 'Lagos' },
      description: null,
    });
    expect(parseProfile({ ...input, businessKind: 'business_name', registrationNumber: '2345678' }).registrationNumber).toBe('BN2345678');
  });

  it.each<[string, Partial<ProfileInput>, string]>([
    ['an RC number for a business name', { businessKind: 'business_name', registrationNumber: 'RC1234567' }, 'BN number'],
    ['letters in the number', { registrationNumber: 'RC12AB' }, 'RC number'],
    ['a foreign phone', { phone: '+1 555 123 4567' }, 'Nigerian mobile'],
    ['an unknown state', { address: { line1: '12 Allen Avenue', city: 'Ikeja', state: 'Atlantis' } }, 'state'],
    ['a malformed TIN', { taxId: '12' }, 'TIN'],
    ['a blank shop name', { displayName: ' ' }, 'shop name'],
  ])('refuses %s', (_name, change, message) => {
    expect(() => parseProfile({ ...input, ...change })).toThrow(message);
  });
});

describe('SellerApplication', () => {
  it('submits once the required documents are attached, snapshotting what was sent', () => {
    const application = started();
    application.addDocument(doc('d1', 'registration_certificate'));
    expect(() => application.submit('c1', ['registration_certificate', 'owner_id'], now)).toThrow("Owner or director's ID");
    application.addDocument(doc('d2', 'owner_id'));
    application.submit('c1', ['registration_certificate', 'owner_id'], now);
    expect(application.status).toBe('pending_verification');
    expect(application.latestCase).toMatchObject({ id: 'c1', status: 'submitted', documentIds: ['d1', 'd2'], profile: { registrationNumber: 'RC1234567' } });
    expect(application.pullEvents()).toEqual([expect.objectContaining({ type: 'SellerApplicationSubmitted', payload: expect.objectContaining({ resubmission: false }) })]);
  });

  it('cannot be changed while under review', () => {
    const application = started();
    application.submit('c1', [], now);
    expect(() => application.updateProfile(parseProfile(input))).toThrow('being reviewed');
    expect(() => application.addDocument(doc('d1', 'other'))).toThrow('being reviewed');
  });

  it('goes back to the applicant with a reason, and keeps both submissions after a resubmission', () => {
    const application = started();
    application.addDocument(doc('d1', 'owner_id'));
    application.submit('c1', ['owner_id'], now);
    expect(() => application.review('request_changes', 'staff1', '  ', now)).toThrow('what the applicant needs to change');
    application.review('request_changes', 'staff1', 'The ID photo is blurred', now);
    expect(application.status).toBe('changes_requested');
    application.removeDocument('d1', now);
    application.addDocument(doc('d2', 'owner_id'));
    application.submit('c2', ['owner_id'], now);
    expect(application.cases.map((entry) => [entry.id, entry.status, entry.documentIds])).toEqual([
      ['c1', 'changes_requested', ['d1']],
      ['c2', 'submitted', ['d2']],
    ]);
    expect(application.allDocuments.find((entry) => entry.id === 'd1')?.removedAt).toEqual(now);
    expect(application.documents.map((entry) => entry.id)).toEqual(['d2']);
  });

  it('approves or rejects only a pending application, and a decision is final', () => {
    const approved = started();
    expect(() => approved.review('approve', 'staff1', null, now)).toThrow('not waiting');
    approved.submit('c1', [], now);
    approved.review('approve', 'staff1', null, now);
    expect(approved.status).toBe('active');
    expect(() => approved.review('reject', 'staff1', 'Changed my mind', now)).toThrow('not waiting');
    expect(() => approved.updateProfile(parseProfile(input))).toThrow('already verified');

    const rejected = started();
    rejected.submit('c1', [], now);
    expect(() => rejected.review('reject', 'staff1', null, now)).toThrow('Say why');
    rejected.review('reject', 'staff1', 'The CAC number belongs to another business', now);
    expect(rejected.status).toBe('rejected');
    expect(rejected.latestCase).toMatchObject({ status: 'rejected', reviewedBy: 'staff1', notes: 'The CAC number belongs to another business' });
  });

  it('caps documents per kind', () => {
    const application = started();
    for (const id of ['a', 'b', 'c']) application.addDocument(doc(id, 'other'));
    expect(() => application.addDocument(doc('d', 'other'))).toThrow('up to 3 files');
  });
});

describe('checkDocumentFile', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 rest');
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

  it('judges the type by content and fixes the name to match', () => {
    expect(checkDocumentFile(pdf, 'C:\\Users\\ada\\CAC cert<script>.exe', 1000)).toEqual({ contentType: 'application/pdf', fileName: 'CAC certscript.pdf' });
    expect(checkDocumentFile(png, 'id.pdf', 1000)).toEqual({ contentType: 'image/png', fileName: 'id.png' });
    expect(checkDocumentFile(pdf, '', 1000).fileName).toBe('document.pdf');
  });

  it('refuses other files, empty files and large files', () => {
    expect(() => checkDocumentFile(new TextEncoder().encode('<html>'), 'a.pdf', 1000)).toThrow('PDF, JPEG, PNG or WebP');
    expect(() => checkDocumentFile(new Uint8Array(), 'a.pdf', 1000)).toThrow('empty');
    expect(() => checkDocumentFile(pdf, 'a.pdf', 5)).toThrow('Files can be up to');
  });
});
