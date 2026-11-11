import path from 'node:path';
import type { NextConfig } from 'next';

const root = path.join(__dirname, '../..');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  turbopack: { root },
  transpilePackages: ['@vendra/ui', '@vendra/api-client', '@vendra/utils', '@vendra/validation'],
};

export default config;
