import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value || !IDEMPOTENCY_KEY.test(value)) {
    throw new BadRequestException('An Idempotency-Key header of 8 to 100 letters, digits, - or _ is required');
  }
  return value;
}

/**
 * Portals call the API from their servers, so the socket address is the portal's.
 * A portal proves itself with the shared secret and then passes on the visitor's
 * address. Without the secret, the header is ignored and cannot be spoofed.
 */
export function clientIp(request: Request, portalSecret: string | undefined): string {
  const fallback = request.ip ?? 'unknown';
  const key = request.header('x-vendra-portal-key');
  const forwarded = request.header('x-vendra-client-ip');
  if (!portalSecret || !key || !forwarded || isIP(forwarded) === 0) return fallback;
  const expected = Buffer.from(portalSecret);
  const given = Buffer.from(key);
  return expected.length === given.length && timingSafeEqual(expected, given) ? forwarded : fallback;
}
