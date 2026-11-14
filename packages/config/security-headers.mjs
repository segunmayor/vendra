/**
 * Security headers for every portal page. Used from each portal's next.config.ts.
 *
 * Next.js needs inline scripts for hydration, so script-src allows 'unsafe-inline'; the
 * other directives still stop framing, plugins, foreign <base> tags and loading scripts or
 * connections from other sites. `formTargets` lets the customer portal send a shopper on to
 * a payment gateway, whose address staff configure.
 *
 * @param {{ production: boolean, formTargets?: string[] }} options
 */
export function securityHeaders({ production, formTargets = [] }) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${production ? '' : ' ws: wss:'}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    `form-action 'self'${formTargets.length ? ` ${formTargets.join(' ')}` : ''}`,
    // No upgrade-insecure-requests: it breaks a production build served over plain HTTP
    // (local checks, private staging). HSTS keeps real visitors on HTTPS.
  ].join('; ');
  const headers = [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
  ];
  return [{ source: '/:path*', headers }];
}
