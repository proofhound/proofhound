import { defineConfig } from 'vitest/config';

import { ciReporterConfig } from '../../scripts/vitest-ci-reporters';

export default defineConfig({
  test: {
    ...ciReporterConfig(),
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'dist/**', 'node_modules/**'],
  },
});
