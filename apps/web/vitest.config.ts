import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { ciReporterConfig } from '../../scripts/vitest-ci-reporters';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    ...ciReporterConfig(),
    environment: 'jsdom',
    exclude: ['node_modules/**', '.next/**', 'dist/**', 'e2e/**'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
  },
});
