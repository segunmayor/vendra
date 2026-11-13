import type { components } from '@vendra/api-client';
import type { Tone } from '@vendra/ui';

export type Application = components['schemas']['ApplicationResponse'];
export type Requirements = components['schemas']['MyApplicationResponse']['requirements'];
export type SellerStatus = Application['status'];
export type DocumentKind = Application['documents'][number]['kind'];

export const STATUS: Record<SellerStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Not sent yet', tone: 'neutral' },
  pending_verification: { label: 'Being reviewed', tone: 'warning' },
  changes_requested: { label: 'Changes needed', tone: 'danger' },
  active: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
};

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  registration_certificate: 'CAC registration certificate',
  owner_id: "Owner or director's ID",
  proof_of_address: 'Proof of business address',
  tax_certificate: 'Tax identification (TIN) certificate',
  other: 'Other document',
};

export const DOCUMENT_HINT: Record<DocumentKind, string> = {
  registration_certificate: 'The certificate CAC issued for your company or business name.',
  owner_id: "National ID card, international passport or driver's licence.",
  proof_of_address: 'A utility bill or tenancy agreement from the last three months.',
  tax_certificate: 'Your TIN certificate from FIRS or the state tax office.',
  other: 'Anything else that helps us verify your business.',
};

export function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const dateTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
