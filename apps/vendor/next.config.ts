import path from 'node:path';
import type { NextConfig } from 'next';

const root = path.join(__dirname, '../..');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  turbopack: { root },
  transpilePackages: ['@vendra/ui', '@vendra/api-client', '@vendra/portal-session', '@vendra/utils', '@vendra/validation'],
  // Verification documents go through Server Actions. The API caps each file at 10 MB, and the
  // size staff allow (Admin, Settings) is checked there; these leave room for the form around it.
  experimental: {
    serverActions: { bodySizeLimit: '11mb' },
    proxyClientMaxBodySize: '11mb',
  },
};

export default config;
