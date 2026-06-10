import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { ciReporterConfig } from '../../scripts/vitest-ci-reporters';

export default defineConfig({
  resolve: {
    alias: {
      '@proofhound/web-ui': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    ...ciReporterConfig(),
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
  },
});
