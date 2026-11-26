import { DomainError } from '../../../shared-kernel';

/** Hard ceiling whatever the setting says: a photo is held in memory while it is checked. */
export const IMAGE_HARD_LIMIT_BYTES = 10 * 1024 * 1024;

const ascii = (bytes: Uint8Array, from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to));

const SIGNATURES: readonly { contentType: string; extension: string; matches: (b: Uint8Array) => boolean }[] = [
  { contentType: 'image/jpeg', extension: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { contentType: 'image/png', extension: 'png', matches: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => b[i] === byte) },
  { contentType: 'image/webp', extension: 'webp', matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  { contentType: 'image/gif', extension: 'gif', matches: (b) => ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a' },
  { contentType: 'image/avif', extension: 'avif', matches: (b) => ascii(b, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 12)) },
];

export const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = Object.fromEntries(SIGNATURES.map((s) => [s.extension, s.contentType]));

/**
 * Accepts JPEG, PNG, GIF (including animated), WebP and AVIF photos, judged by the first bytes rather than the address or
 * the type the server claimed. SVG is refused on purpose: it can carry scripts.
 */
export function checkImage(bytes: Uint8Array, maxBytes: number): { contentType: string; extension: string } {
  if (bytes.length === 0) throw new DomainError('media.empty', 'The address returned an empty file');
  const limit = Math.min(maxBytes, IMAGE_HARD_LIMIT_BYTES);
  if (bytes.length > limit) throw new DomainError('media.too_large', `Photos can be up to ${Math.floor(limit / (1024 * 1024))} MB`);
  const signature = SIGNATURES.find((candidate) => candidate.matches(bytes));
  if (signature) return { contentType: signature.contentType, extension: signature.extension };
  const start = ascii(bytes, 0, Math.min(bytes.length, 512)).toLowerCase();
  if (start.includes('<html') || start.includes('<!doctype')) {
    throw new DomainError(
      'media.not_an_image',
      'The address returned a web page, not a photo. Use a direct link to the image file (share links from Google Drive or Dropbox open a page).',
    );
  }
  throw new DomainError('media.not_an_image', 'The file is not a JPEG, PNG, GIF, WebP or AVIF photo');
}
