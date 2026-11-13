import { DomainError } from '../../../shared-kernel';

/** Hard ceiling whatever the setting says: the request body is held in memory. */
export const DOCUMENT_HARD_LIMIT_BYTES = 10 * 1024 * 1024;

const SIGNATURES: readonly { type: string; extension: string; matches: (bytes: Uint8Array) => boolean }[] = [
  { type: 'application/pdf', extension: 'pdf', matches: (b) => ascii(b, 0, 5) === '%PDF-' },
  { type: 'image/png', extension: 'png', matches: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => b[i] === byte) },
  { type: 'image/jpeg', extension: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/webp', extension: 'webp', matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
];

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

export interface CheckedFile {
  readonly contentType: string;
  readonly fileName: string;
}

/**
 * Accepts PDFs and photos only, judged by the file's first bytes rather than the name or the
 * type the browser claimed. The stored name keeps letters, numbers and simple punctuation, and
 * always ends in the extension of what the file really is.
 */
export function checkDocumentFile(bytes: Uint8Array, originalName: string, maxBytes: number): CheckedFile {
  if (bytes.length === 0) throw new DomainError('seller.document_empty', 'That file is empty');
  const limit = Math.min(maxBytes, DOCUMENT_HARD_LIMIT_BYTES);
  if (bytes.length > limit) throw new DomainError('seller.document_too_large', `Files can be up to ${Math.floor(limit / (1024 * 1024))} MB`);
  const signature = SIGNATURES.find((candidate) => candidate.matches(bytes));
  if (!signature) throw new DomainError('seller.document_type', 'Upload a PDF, JPEG, PNG or WebP file');
  const base =
    originalName
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[^.]*$/, '')
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N} ._()-]+/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'document';
  return { contentType: signature.type, fileName: `${base}.${signature.extension}` };
}
