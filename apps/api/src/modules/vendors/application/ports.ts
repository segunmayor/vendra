import { AuditEntry } from '../../../shared-kernel';
import { SellerApplication, SellerStatus } from '../domain/seller-application';

export interface DocumentUpload {
  readonly documentId: string;
  readonly content: Uint8Array;
}

export interface SellerApplicationRepository {
  findById(id: string): Promise<SellerApplication | null>;
  findByOwner(accountId: string): Promise<SellerApplication | null>;
  /** Marketplace applications only, oldest submission first when filtered by status. */
  list(status: SellerStatus | undefined, limit: number): Promise<SellerApplication[]>;
  /** Other applications giving the same CAC number, so staff can spot a duplicate or a borrowed number. */
  withRegistrationNumber(registrationNumber: string, exceptId: string): Promise<SellerApplication[]>;
  countByStatus(): Promise<Partial<Record<SellerStatus, number>>>;
  /**
   * Saves state, new document files, events and the audit entry together. Throws
   * ConcurrencyConflict if the version moved, and an `seller.application_exists` conflict when
   * the account already has an application.
   */
  save(application: SellerApplication, audit: AuditEntry, uploads?: readonly DocumentUpload[]): Promise<void>;
  readDocument(sellerId: string, documentId: string): Promise<Uint8Array | null>;
}
