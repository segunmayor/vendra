import path from 'node:path';
import { securityHeaders } from '@vendra/config/security-headers';
import type { NextConfig } from 'next';

const root = path.join(__dirname, '../..');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  turbopack: { root },
  // Payment gateways are chosen in Admin, so any https address may receive the checkout form.
  headers: async () => securityHeaders({ production: process.env.NODE_ENV === 'production', formTargets: ['https:'] }),
  transpilePackages: ['@vendra/ui', '@vendra/api-client', '@vendra/portal-session', '@vendra/utils', '@vendra/validation'],
};

export default config;
