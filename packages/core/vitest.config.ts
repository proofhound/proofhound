import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

import { ciReporterConfig } from '../../scripts/vitest-ci-reporters';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    ...ciReporterConfig(),
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**', 'test/**'],
    pool: 'forks',
    setupFiles: ['reflect-metadata'],
    testTimeout: 10_000,
    passWithNoTests: true,
    coverage: { provider: 'v8', reportsDirectory: './coverage' },
  },
});
