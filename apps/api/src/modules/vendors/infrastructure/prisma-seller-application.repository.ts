import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { appendAudit } from '../../../platform/audit/audit';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { ApplicationError, AuditEntry, ConcurrencyConflict } from '../../../shared-kernel';
import { DocumentUpload, SellerApplicationRepository } from '../application/ports';
import { BusinessAddress, BusinessKind, BusinessProfile, CaseStatus, DocumentKind, SellerApplication, SellerStatus } from '../domain/seller-application';

/** Never loads file contents: those are read one at a time, on request. */
const include = {
  documents: { select: { id: true, kind: true, fileName: true, contentType: true, sizeBytes: true, uploadedAt: true, removedAt: true }, orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }] },
  cases: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.SellerInclude;

type Row = Prisma.SellerGetPayload<{ include: typeof include }>;

const MARKETPLACE = { type: 'marketplace' } as const;

export class PrismaSellerApplicationRepository implements SellerApplicationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<SellerApplication | null> {
    const row = await this.prisma.seller.findFirst({ where: { id, ...MARKETPLACE }, include });
    return row ? toApplication(row) : null;
  }

  async findByOwner(accountId: string): Promise<SellerApplication | null> {
    const row = await this.prisma.seller.findFirst({ where: { ownerAccount: accountId, ...MARKETPLACE }, include });
    return row ? toApplication(row) : null;
  }

  async list(status: SellerStatus | undefined, limit: number): Promise<SellerApplication[]> {
    const rows = await this.prisma.seller.findMany({
      where: { ...MARKETPLACE, ...(status ? { status } : {}) },
      include,
      orderBy: status ? [{ updatedAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toApplication);
  }

  async withRegistrationNumber(registrationNumber: string, exceptId: string): Promise<SellerApplication[]> {
    const rows = await this.prisma.seller.findMany({ where: { ...MARKETPLACE, registrationNumber, id: { not: exceptId } }, include, orderBy: { createdAt: 'asc' }, take: 20 });
    return rows.map(toApplication);
  }

  async countByStatus(): Promise<Partial<Record<SellerStatus, number>>> {
    const groups = await this.prisma.seller.groupBy({ by: ['status'], where: MARKETPLACE, _count: { _all: true } });
    return Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
  }

  async readDocument(sellerId: string, documentId: string): Promise<Uint8Array | null> {
    const row = await this.prisma.sellerDocument.findFirst({ where: { id: documentId, sellerId }, select: { content: true } });
    return row ? new Uint8Array(row.content) : null;
  }

  async save(application: SellerApplication, audit: AuditEntry, uploads: readonly DocumentUpload[] = []): Promise<void> {
    try {
      await this.write(application, audit, uploads);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApplicationError('conflict', 'seller.application_exists', 'This account already has a seller application');
      }
      throw error;
    }
  }

  private async write(application: SellerApplication, audit: AuditEntry, uploads: readonly DocumentUpload[]): Promise<void> {
    const events = application.pullEvents();
    const profile = application.profile;
    const fields = {
      status: application.status,
      displayName: profile.displayName,
      legalName: profile.legalName,
      businessKind: profile.businessKind,
      registrationNumber: profile.registrationNumber,
      taxId: profile.taxId,
      phone: profile.phone,
      address: profile.address as unknown as Prisma.InputJsonObject,
      description: profile.description,
    };

    await this.prisma.$transaction(async (tx) => {
      if (application.version === 0) {
        await tx.seller.create({ data: { id: application.id, type: 'marketplace', ownerAccount: application.ownerAccountId, createdAt: application.createdAt, version: 1, ...fields } });
      } else {
        const updated = await tx.seller.updateMany({ where: { id: application.id, version: application.version }, data: { ...fields, version: { increment: 1 } } });
        if (updated.count === 0) throw new ConcurrencyConflict('Seller', application.id);
      }

      for (const upload of uploads) {
        const document = application.allDocuments.find((entry) => entry.id === upload.documentId);
        if (!document) throw new Error(`Upload ${upload.documentId} has no document on the application`);
        await tx.sellerDocument.create({
          data: {
            id: document.id,
            sellerId: application.id,
            kind: document.kind,
            fileName: document.fileName,
            contentType: document.contentType,
            sizeBytes: upload.content.length,
            sha256: createHash('sha256').update(upload.content).digest('hex'),
            content: Buffer.from(upload.content),
            uploadedAt: document.uploadedAt,
          },
        });
      }
      if (application.discardedDocumentIds.length > 0) {
        await tx.sellerDocument.deleteMany({ where: { sellerId: application.id, id: { in: [...application.discardedDocumentIds] } } });
      }
      for (const document of application.allDocuments) {
        if (document.removedAt) await tx.sellerDocument.updateMany({ where: { id: document.id, removedAt: null }, data: { removedAt: document.removedAt } });
      }

      for (const entry of application.cases) {
        const data = {
          status: entry.status,
          documents: { profile: entry.profile, documentIds: entry.documentIds } as unknown as Prisma.InputJsonObject,
          reviewedBy: entry.reviewedBy,
          reviewedAt: entry.reviewedAt,
          notes: entry.notes,
        };
        await tx.verificationCase.upsert({ where: { id: entry.id }, create: { id: entry.id, sellerId: application.id, createdAt: entry.submittedAt, ...data }, update: data });
      }

      await appendToOutbox(tx, events);
      await appendAudit(tx, audit);
    });
    application.markSaved();
  }
}

function toApplication(row: Row): SellerApplication {
  return SellerApplication.rehydrate({
    id: row.id,
    ownerAccountId: row.ownerAccount!,
    status: row.status as SellerStatus,
    profile: {
      displayName: row.displayName,
      legalName: row.legalName,
      businessKind: row.businessKind as BusinessKind,
      registrationNumber: row.registrationNumber!,
      taxId: row.taxId,
      phone: row.phone!,
      address: row.address as unknown as BusinessAddress,
      description: row.description,
    },
    documents: row.documents.map((document) => ({ ...document, kind: document.kind as DocumentKind })),
    cases: row.cases.map((entry) => {
      const submitted = entry.documents as unknown as { profile: BusinessProfile; documentIds: string[] };
      return {
        id: entry.id,
        status: entry.status as CaseStatus,
        profile: submitted.profile,
        documentIds: submitted.documentIds,
        submittedAt: entry.createdAt,
        reviewedBy: entry.reviewedBy,
        reviewedAt: entry.reviewedAt,
        notes: entry.notes,
      };
    }),
    createdAt: row.createdAt,
    version: row.version,
  });
}
