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
};

export default config;
