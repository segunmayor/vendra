import path from 'node:path';
import { securityHeaders } from '@vendra/config/security-headers';
import type { NextConfig } from 'next';

const root = path.join(__dirname, '../..');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  turbopack: { root },
  headers: async () => securityHeaders({ production: process.env.NODE_ENV === 'production' }),
  transpilePackages: ['@vendra/ui', '@vendra/api-client', '@vendra/portal-session', '@vendra/utils', '@vendra/validation'],
  // Product files go through a Server Action. The API caps them at 20 MB, and the size staff
  // allow (Settings, Product imports) is checked there; these leave room for the form around it.
  experimental: {
    serverActions: { bodySizeLimit: '21mb' },
    proxyClientMaxBodySize: '21mb',
  },
};

export default config;
