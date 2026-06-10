import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

import { ciReporterConfig } from '../../scripts/vitest-ci-reporters';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    ...ciReporterConfig(),
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    pool: 'forks',
    setupFiles: ['reflect-metadata'],
    testTimeout: 10_000,
    passWithNoTests: true,
    coverage: { provider: 'v8', reportsDirectory: '../coverage' },
  },
});
