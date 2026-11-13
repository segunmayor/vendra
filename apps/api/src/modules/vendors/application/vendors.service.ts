import { ApplicationError, ConcurrencyConflict, Principal } from '../../../shared-kernel';
import { SettingKey, SettingValue } from '../../settings';
import { checkDocumentFile } from '../domain/document-file';
import {
  BusinessProfile,
  DOCUMENT_KINDS,
  DocumentKind,
  parseProfile,
  ProfileInput,
  ReviewDecision,
  SellerApplication,
  SellerDocument,
  SellerStatus,
  VerificationCase,
} from '../domain/seller-application';
import { SellerApplicationRepository } from './ports';

export { DOCUMENT_KINDS } from '../domain/seller-application';
export { DOCUMENT_HARD_LIMIT_BYTES } from '../domain/document-file';

type Settings = { get<K extends SettingKey>(key: K): Promise<SettingValue<K>> };

/** Which document kinds each setting makes required. */
const REQUIRED_BY: readonly [DocumentKind, SettingKey][] = [
  ['registration_certificate', 'vendors.requireRegistrationCertificate'],
  ['owner_id', 'vendors.requireOwnerId'],
  ['proof_of_address', 'vendors.requireProofOfAddress'],
  ['tax_certificate', 'vendors.requireTaxCertificate'],
];

export interface Requirements {
  readonly open: boolean;
  readonly requiredDocuments: readonly DocumentKind[];
  readonly documentKinds: readonly DocumentKind[];
  readonly maxDocumentBytes: number;
  readonly approvedMessage: string;
}

export interface ApplicationView {
  readonly id: string;
  readonly status: SellerStatus;
  readonly profile: BusinessProfile;
  readonly documents: readonly SellerDocument[];
  readonly missingDocuments: readonly DocumentKind[];
  readonly editable: boolean;
  readonly submittedAt: Date | null;
  /** The staff decision on the latest submission, once there is one. */
  readonly decision: { readonly status: VerificationCase['status']; readonly note: string | null; readonly at: Date } | null;
  readonly createdAt: Date;
  readonly version: number;
}

export interface StaffApplicationView extends ApplicationView {
  readonly ownerAccountId: string;
  readonly ownerEmail: string | null;
  /** Every submission, newest first, with what was submitted and what staff decided. */
  readonly cases: readonly (VerificationCase & { readonly documents: readonly SellerDocument[] })[];
  /** Other applications with the same CAC number. */
  readonly sameRegistration: readonly { readonly id: string; readonly displayName: string; readonly status: SellerStatus }[];
}

export interface DocumentFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: Uint8Array;
}

const notFound = () => new ApplicationError('not_found', 'seller.not_found', 'Application not found');
const changed = () => new ApplicationError('conflict', 'seller.changed', 'This application has just been changed elsewhere. Reload to see the latest version.');

/**
 * Businesses apply to sell and staff verify them. At launch an approved seller cannot list
 * products yet: marketplace selling opens after launch, on the same Seller record.
 */
export class VendorsService {
  constructor(
    private readonly applications: SellerApplicationRepository,
    private readonly settings: Settings,
    private readonly accounts: { emailOf(accountId: string): Promise<string | null> },
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
  ) {}

  async requirements(): Promise<Requirements> {
    const required: DocumentKind[] = [];
    for (const [kind, key] of REQUIRED_BY) if (await this.settings.get(key)) required.push(kind);
    return {
      open: await this.settings.get('vendors.applicationsOpen'),
      requiredDocuments: required,
      documentKinds: DOCUMENT_KINDS,
      maxDocumentBytes: (await this.settings.get('vendors.maxDocumentMb')) * 1024 * 1024,
      approvedMessage: await this.settings.get('vendors.approvedMessage'),
    };
  }

  // ---------- applicants ----------

  async mine(principal: Principal): Promise<{ application: ApplicationView | null; requirements: Requirements }> {
    const requirements = await this.requirements();
    const application = await this.applications.findByOwner(principal.accountId);
    return { application: application ? view(application, requirements.requiredDocuments) : null, requirements };
  }

  /** Starts the application, or changes its details while it can still be changed. */
  async saveDetails(principal: Principal, input: ProfileInput, version?: number): Promise<ApplicationView> {
    const requirements = await this.requirements();
    const profile = parseProfile(input);
    let application = await this.applications.findByOwner(principal.accountId);
    if (!application) {
      if (!requirements.open) throw new ApplicationError('forbidden', 'seller.applications_closed', 'We are not accepting new seller applications at the moment');
      application = SellerApplication.start({ id: this.ids.uuid(), ownerAccountId: principal.accountId, profile, now: this.clock.now() });
    } else {
      if (version !== undefined && version !== application.version) throw changed();
      application.updateProfile(profile);
    }
    await this.persist(application, { action: 'sellers.details_saved', actorId: principal.accountId, after: { displayName: profile.displayName, registrationNumber: profile.registrationNumber } });
    return view(application, requirements.requiredDocuments);
  }

  async addDocument(principal: Principal, input: { kind: DocumentKind; fileName: string; content: Uint8Array }): Promise<ApplicationView> {
    const requirements = await this.requirements();
    const application = await this.own(principal);
    const file = checkDocumentFile(input.content, input.fileName, requirements.maxDocumentBytes);
    const document = { id: this.ids.uuid(), kind: input.kind, fileName: file.fileName, contentType: file.contentType, sizeBytes: input.content.length, uploadedAt: this.clock.now() };
    application.addDocument(document);
    await this.persist(
      application,
      { action: 'sellers.document_added', actorId: principal.accountId, after: { documentId: document.id, kind: document.kind, fileName: document.fileName, sizeBytes: document.sizeBytes } },
      [{ documentId: document.id, content: input.content }],
    );
    return view(application, requirements.requiredDocuments);
  }

  async removeDocument(principal: Principal, documentId: string): Promise<ApplicationView> {
    const requirements = await this.requirements();
    const application = await this.own(principal);
    application.removeDocument(documentId, this.clock.now());
    await this.persist(application, { action: 'sellers.document_removed', actorId: principal.accountId, after: { documentId } });
    return view(application, requirements.requiredDocuments);
  }

  async submit(principal: Principal, version?: number): Promise<ApplicationView> {
    const requirements = await this.requirements();
    const application = await this.own(principal);
    if (version !== undefined && version !== application.version) throw changed();
    application.submit(this.ids.uuid(), requirements.requiredDocuments, this.clock.now());
    await this.persist(application, { action: 'sellers.submitted', actorId: principal.accountId, after: { caseId: application.latestCase!.id, documents: application.documents.length } });
    return view(application, requirements.requiredDocuments);
  }

  /** Applicants can open their own files, including those from earlier submissions. */
  async myDocument(principal: Principal, documentId: string): Promise<DocumentFile> {
    return this.file(await this.own(principal), documentId);
  }

  // ---------- staff ----------

  async list(status?: SellerStatus): Promise<ApplicationView[]> {
    const required = (await this.requirements()).requiredDocuments;
    return (await this.applications.list(status, 200)).map((application) => view(application, required));
  }

  async counts(): Promise<Partial<Record<SellerStatus, number>>> {
    return this.applications.countByStatus();
  }

  async get(id: string): Promise<StaffApplicationView> {
    const application = await this.applications.findById(id);
    if (!application) throw notFound();
    const required = (await this.requirements()).requiredDocuments;
    const byId = new Map(application.allDocuments.map((document) => [document.id, document]));
    return {
      ...view(application, required),
      ownerAccountId: application.ownerAccountId,
      ownerEmail: await this.accounts.emailOf(application.ownerAccountId),
      cases: application.cases
        .map((entry) => ({ ...entry, documents: entry.documentIds.flatMap((documentId) => byId.get(documentId) ?? []) }))
        .reverse(),
      sameRegistration: (await this.applications.withRegistrationNumber(application.profile.registrationNumber, application.id)).map((other) => ({
        id: other.id,
        displayName: other.profile.displayName,
        status: other.status,
      })),
    };
  }

  async document(id: string, documentId: string): Promise<DocumentFile> {
    const application = await this.applications.findById(id);
    if (!application) throw notFound();
    return this.file(application, documentId);
  }

  /** `version` is the one the reviewer was looking at, so a decision is never made on an unseen resubmission. */
  async review(actor: Principal, id: string, input: { decision: ReviewDecision; note?: string | null; version?: number }): Promise<StaffApplicationView> {
    const application = await this.applications.findById(id);
    if (!application) throw notFound();
    if (input.version !== undefined && input.version !== application.version) throw changed();
    const before = application.status;
    application.review(input.decision, actor.accountId, input.note ?? null, this.clock.now());
    await this.persist(application, {
      action: 'sellers.reviewed',
      actorId: actor.accountId,
      before: { status: before },
      after: { status: application.status, decision: input.decision, caseId: application.latestCase!.id, ...(application.latestCase!.notes ? { note: application.latestCase!.notes } : {}) },
    });
    return this.get(id);
  }

  // ---------- helpers ----------

  private async own(principal: Principal): Promise<SellerApplication> {
    const application = await this.applications.findByOwner(principal.accountId);
    if (!application) throw new ApplicationError('not_found', 'seller.not_found', 'Start your application by saving your business details first');
    return application;
  }

  private async file(application: SellerApplication, documentId: string): Promise<DocumentFile> {
    const document = application.allDocuments.find((entry) => entry.id === documentId);
    const content = document ? await this.applications.readDocument(application.id, documentId) : null;
    if (!document || !content) throw new ApplicationError('not_found', 'seller.document_not_found', 'Document not found');
    return { fileName: document.fileName, contentType: document.contentType, content };
  }

  private async persist(
    application: SellerApplication,
    audit: { action: string; actorId: string; before?: Record<string, unknown>; after?: Record<string, unknown> },
    uploads?: readonly { documentId: string; content: Uint8Array }[],
  ): Promise<void> {
    try {
      await this.applications.save(application, { ...audit, targetType: 'seller', targetId: application.id }, uploads);
    } catch (error) {
      if (error instanceof ConcurrencyConflict) throw changed();
      throw error;
    }
  }
}

function view(application: SellerApplication, required: readonly DocumentKind[]): ApplicationView {
  const latest = application.latestCase;
  return {
    id: application.id,
    status: application.status,
    profile: application.profile,
    documents: application.documents,
    missingDocuments: application.missing(required),
    editable: application.editable,
    submittedAt: latest?.submittedAt ?? null,
    decision: latest?.reviewedAt ? { status: latest.status, note: latest.notes, at: latest.reviewedAt } : null,
    createdAt: application.createdAt,
    version: application.version,
  };
}
