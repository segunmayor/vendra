import type { components } from '@vendra/api-client';
import type { Tone } from '@vendra/ui';

export type SellerStatus = components['schemas']['ApplicationResponse']['status'];
export type DocumentKind = components['schemas']['DocumentDto']['kind'];
export type CaseStatus = components['schemas']['CaseDto']['status'];

export const SELLER_STATUSES: readonly SellerStatus[] = ['pending_verification', 'changes_requested', 'draft', 'active', 'rejected'];

export const SELLER_LABEL: Record<SellerStatus, string> = {
  draft: 'Not sent yet',
  pending_verification: 'To review',
  changes_requested: 'Waiting for changes',
  active: 'Verified',
  rejected: 'Rejected',
};

export const SELLER_TONE: Record<SellerStatus, Tone> = {
  draft: 'neutral',
  pending_verification: 'warning',
  changes_requested: 'neutral',
  active: 'success',
  rejected: 'danger',
};

export const CASE_LABEL: Record<CaseStatus, string> = {
  submitted: 'Waiting for a decision',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes asked for',
};

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  registration_certificate: 'CAC registration certificate',
  owner_id: "Owner or director's ID",
  proof_of_address: 'Proof of business address',
  tax_certificate: 'TIN certificate',
  other: 'Other document',
};

export const KIND_LABEL = { company: 'Company', business_name: 'Business name' } as const;

export function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
