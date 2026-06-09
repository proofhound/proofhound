import path from 'node:path';
import type { NextConfig } from 'next';

const repoRoot = path.resolve(process.cwd(), '../..');
const webUiGlobalsCss = path.join(repoRoot, 'packages/web-ui/src/styles/globals.css');
const webUiGlobalsCssTurbopackAlias = '../../packages/web-ui/src/styles/globals.css';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@proofhound/api-client',
    '@proofhound/logger',
    '@proofhound/shared',
    '@proofhound/ui',
    '@proofhound/web-ui',
  ],
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      '@proofhound/web-ui/styles/globals.css': webUiGlobalsCssTurbopackAlias,
    },
  },
  typedRoutes: true,
  poweredByHeader: false,
  webpack(webpackConfig) {
    webpackConfig.resolve ??= {};
    webpackConfig.resolve.alias ??= {};
    webpackConfig.resolve.alias['@proofhound/web-ui/styles/globals.css'] = webUiGlobalsCss;
    return webpackConfig;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default config;
