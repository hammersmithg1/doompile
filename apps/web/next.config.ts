import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  // Personal agent resources live under .agents; keep generated instructions out of the app.
  agentRules: false,
  devIndicators: process.env.DOOMPILE_MOBILE_TEST ? false : undefined,
  output: 'standalone',
  // Keep native clients on the origin API while exposing the web entry at /doompile.
  async rewrites() { return [{ source: '/doompile', destination: '/' }]; },
  env: { NEXT_PUBLIC_DOOMPILE_RELEASE: process.env.DOOMPILE_RELEASE || process.env.DOOMPILE_BUILD_COMMIT || process.env.GITHUB_SHA || 'development' },
  distDir: process.env.DOOMPILE_BUILD_DIR || (process.env.DOOMPILE_MOBILE_TEST ? '.next-mobile-tests' : process.env.DOOMPILE_EDITOR_TEST ? '.next-editor-tests' : '.next'),
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  turbopack: { root: path.join(import.meta.dirname, '../..') },
  serverExternalPackages: ['node:sqlite', '@aws-sdk/client-s3', '@aws-sdk/lib-storage', 'jose'],
};
export default config;
