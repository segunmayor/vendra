import { AggregateRoot, DomainError, isNigerianState, nigerianMobile } from '../../../shared-kernel';

/**
 * A business applying to sell, and its verification. The record is a `Seller` of type
 * `marketplace`; Vendra's own seller never goes through this.
 *
 *   draft ──submit──▶ pending_verification ──approve──▶ active
 *     ▲                        │ └──────────reject───▶ rejected
 *     └──── changes_requested ◀┘ request changes
 *
 * Details and documents can be changed only in draft or changes_requested, so what staff
 * review is what was submitted. Each submission is a verification case holding a snapshot of
 * the details and the documents submitted with it.
 */
export type SellerStatus = 'draft' | 'pending_verification' | 'changes_requested' | 'active' | 'rejected';
export type BusinessKind = 'company' | 'business_name';
export const DOCUMENT_KINDS = ['registration_certificate', 'owner_id', 'proof_of_address', 'tax_certificate', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type ReviewDecision = 'approve' | 'reject' | 'request_changes';
export type CaseStatus = 'submitted' | 'approved' | 'rejected' | 'changes_requested';

/** Safety caps, not business choices: they bound storage per application. */
export const MAX_DOCUMENTS = 12;
export const MAX_PER_KIND = 3;

export interface BusinessAddress {
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
}

export interface BusinessProfile {
  readonly displayName: string;
  readonly legalName: string;
  readonly businessKind: BusinessKind;
  /** CAC number with its prefix: RC for a company, BN for a business name. */
  readonly registrationNumber: string;
  readonly taxId: string | null;
  readonly phone: string;
  readonly address: BusinessAddress;
  readonly description: string | null;
}

export interface SellerDocument {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
  readonly removedAt: Date | null;
}

export interface VerificationCase {
  readonly id: string;
  readonly status: CaseStatus;
  readonly profile: BusinessProfile;
  readonly documentIds: readonly string[];
  readonly submittedAt: Date;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
  readonly notes: string | null;
}

export interface SellerApplicationState {
  readonly id: string;
  readonly ownerAccountId: string;
  readonly status: SellerStatus;
  readonly profile: BusinessProfile;
  readonly documents: readonly SellerDocument[];
  readonly cases: readonly VerificationCase[];
  readonly createdAt: Date;
  readonly version: number;
}

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  registration_certificate: 'CAC registration certificate',
  owner_id: "Owner or director's ID",
  proof_of_address: 'Proof of business address',
  tax_certificate: 'Tax identification (TIN) certificate',
  other: 'Other document',
};

const invalid = (field: string, message: string) => new DomainError(`seller.invalid_${field}`, message);

function text(value: string | null | undefined, field: string, label: string, min: number, max: number): string {
  const trimmed = (value ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length < min) throw invalid(field, `Enter the ${label}`);
  if (trimmed.length > max) throw invalid(field, `Use at most ${max} characters for the ${label}`);
  return trimmed;
}

function optional(value: string | null | undefined, field: string, label: string, max: number): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw invalid(field, `Use at most ${max} characters for the ${label}`);
  return trimmed;
}

export interface ProfileInput {
  readonly displayName: string;
  readonly legalName: string;
  readonly businessKind: BusinessKind;
  readonly registrationNumber: string;
  readonly taxId?: string | null;
  readonly phone: string;
  readonly address: { readonly line1: string; readonly line2?: string | null; readonly city: string; readonly state: string };
  readonly description?: string | null;
}

/** Checks and tidies what an applicant typed. */
export function parseProfile(input: ProfileInput): BusinessProfile {
  const prefix = input.businessKind === 'company' ? 'RC' : input.businessKind === 'business_name' ? 'BN' : null;
  if (!prefix) throw invalid('business_kind', 'Choose whether you are a registered company or a registered business name');
  const digits = new RegExp(`^(?:${prefix})?(\\d{3,8})$`).exec(input.registrationNumber.toUpperCase().replace(/[\s.-]/g, ''));
  if (!digits) {
    throw invalid('registration_number', prefix === 'RC' ? 'Enter the RC number from your CAC certificate, such as RC 1234567' : 'Enter the BN number from your CAC certificate, such as BN 1234567');
  }
  const taxId = optional(input.taxId, 'tax_id', 'tax identification number', 20);
  if (taxId && !/^\d{8}-?\d{4}$|^\d{10}$/.test(taxId.replace(/\s/g, ''))) {
    throw invalid('tax_id', 'Enter the TIN as printed, such as 12345678-0001, or leave it blank');
  }
  const phone = nigerianMobile(input.phone);
  if (!phone) throw invalid('phone', 'Enter a Nigerian mobile number, such as 0803 123 4567');
  const state = input.address.state.trim();
  if (!isNigerianState(state)) throw invalid('state', 'Choose the state your business is in');
  return {
    displayName: text(input.displayName, 'display_name', 'shop name', 2, 80),
    legalName: text(input.legalName, 'legal_name', 'registered business name', 2, 160),
    businessKind: input.businessKind,
    registrationNumber: `${prefix}${digits[1]}`,
    taxId: taxId ? taxId.replace(/\s/g, '') : null,
    phone,
    address: {
      line1: text(input.address.line1, 'address', 'street address', 3, 160),
      line2: optional(input.address.line2, 'address', 'second address line', 160),
      city: text(input.address.city, 'city', 'town or city', 2, 80),
      state,
    },
    description: optional(input.description, 'description', 'description', 1000),
  };
}

export class SellerApplication extends AggregateRoot {
  private state: SellerApplicationState;

  private constructor(state: SellerApplicationState) {
    super();
    this.state = state;
  }

  static start(input: { id: string; ownerAccountId: string; profile: BusinessProfile; now: Date }): SellerApplication {
    return new SellerApplication({
      id: input.id,
      ownerAccountId: input.ownerAccountId,
      status: 'draft',
      profile: input.profile,
      documents: [],
      cases: [],
      createdAt: input.now,
      version: 0,
    });
  }

  static rehydrate(state: SellerApplicationState): SellerApplication {
    return new SellerApplication(state);
  }

  get id(): string {
    return this.state.id;
  }
  get ownerAccountId(): string {
    return this.state.ownerAccountId;
  }
  get status(): SellerStatus {
    return this.state.status;
  }
  get profile(): BusinessProfile {
    return this.state.profile;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get version(): number {
    return this.state.version;
  }
  get cases(): readonly VerificationCase[] {
    return this.state.cases;
  }
  /** Documents currently attached (removed ones are kept for earlier submissions). */
  get documents(): readonly SellerDocument[] {
    return this.state.documents.filter((document) => !document.removedAt);
  }
  get allDocuments(): readonly SellerDocument[] {
    return this.state.documents;
  }
  get editable(): boolean {
    return this.state.status === 'draft' || this.state.status === 'changes_requested';
  }
  get latestCase(): VerificationCase | null {
    return this.state.cases.at(-1) ?? null;
  }

  updateProfile(profile: BusinessProfile): void {
    this.assertEditable();
    this.state = { ...this.state, profile };
  }

  addDocument(document: Omit<SellerDocument, 'removedAt'>): void {
    this.assertEditable();
    const current = this.documents;
    if (current.length >= MAX_DOCUMENTS) throw new DomainError('seller.too_many_documents', `You can attach up to ${MAX_DOCUMENTS} documents. Remove one first.`);
    if (current.filter((existing) => existing.kind === document.kind).length >= MAX_PER_KIND) {
      throw new DomainError('seller.too_many_documents', `You can attach up to ${MAX_PER_KIND} files for "${DOCUMENT_LABEL[document.kind]}". Remove one first.`);
    }
    this.state = { ...this.state, documents: [...this.state.documents, { ...document, removedAt: null }] };
  }

  removeDocument(documentId: string, now: Date): void {
    this.assertEditable();
    if (!this.documents.some((document) => document.id === documentId)) throw new DomainError('seller.document_not_found', 'That document is not attached');
    this.state = {
      ...this.state,
      documents: this.state.documents.map((document) => (document.id === documentId ? { ...document, removedAt: now } : document)),
    };
  }

  /** Required kinds with no document attached yet. */
  missing(required: readonly DocumentKind[]): DocumentKind[] {
    const present = new Set(this.documents.map((document) => document.kind));
    return required.filter((kind) => !present.has(kind));
  }

  submit(caseId: string, required: readonly DocumentKind[], now: Date): void {
    this.assertEditable();
    const missing = this.missing(required);
    if (missing.length > 0) {
      throw new DomainError('seller.documents_missing', `Attach these before submitting: ${missing.map((kind) => DOCUMENT_LABEL[kind]).join(', ')}`);
    }
    const submission: VerificationCase = {
      id: caseId,
      status: 'submitted',
      profile: this.state.profile,
      documentIds: this.documents.map((document) => document.id),
      submittedAt: now,
      reviewedBy: null,
      reviewedAt: null,
      notes: null,
    };
    this.state = { ...this.state, status: 'pending_verification', cases: [...this.state.cases, submission] };
    this.raise({
      type: 'SellerApplicationSubmitted',
      aggregateId: this.id,
      occurredAt: now,
      payload: { sellerId: this.id, ownerAccountId: this.ownerAccountId, caseId, resubmission: this.state.cases.length > 1 },
    });
  }

  /** Staff decide on the latest submission. Rejecting or asking for changes needs a reason the applicant will read. */
  review(decision: ReviewDecision, reviewerId: string, note: string | null, now: Date): void {
    if (this.state.status !== 'pending_verification') throw new DomainError('seller.not_pending', 'This application is not waiting for a decision');
    const reason = note?.trim() || null;
    if (decision !== 'approve' && (!reason || reason.length < 3)) {
      throw new DomainError('seller.reason_required', decision === 'reject' ? 'Say why the application is rejected' : 'Say what the applicant needs to change');
    }
    if (reason && reason.length > 1000) throw new DomainError('seller.reason_too_long', 'Use at most 1,000 characters');
    const outcome = { approve: ['approved', 'active'], reject: ['rejected', 'rejected'], request_changes: ['changes_requested', 'changes_requested'] } as const;
    const [caseStatus, status] = outcome[decision];
    const cases = this.state.cases.map((entry, index, all) =>
      index === all.length - 1 ? { ...entry, status: caseStatus, reviewedBy: reviewerId, reviewedAt: now, notes: reason } : entry,
    );
    this.state = { ...this.state, status, cases };
    const type = { approve: 'SellerApproved', reject: 'SellerRejected', request_changes: 'SellerChangesRequested' }[decision];
    this.raise({ type, aggregateId: this.id, occurredAt: now, payload: { sellerId: this.id, ownerAccountId: this.ownerAccountId, caseId: this.latestCase!.id } });
  }

  /** Called by the repository after a successful save. */
  markSaved(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
  }

  private assertEditable(): void {
    if (this.editable) return;
    const message =
      this.state.status === 'pending_verification'
        ? 'Your application is being reviewed. You can change it if we ask for changes.'
        : this.state.status === 'active'
          ? 'Your business is already verified'
          : 'This application was not approved and cannot be changed';
    throw new DomainError('seller.not_editable', message);
  }
}
