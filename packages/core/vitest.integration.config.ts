import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

import { ciReporterConfig } from '../../scripts/vitest-ci-reporters';

// DBOS workflow integration test config —
//   - DBOS.launch() is a global singleton + setup.ts beforeAll scans dangling dbos_test_* schemas;
//     parallel workers would step on each other; singleFork + fileParallelism:false serializes them,
//     equivalent to maxWorkers:1 in the old jest.integration.config.js.
//   - hookTimeout: 300s gives DBOS.launch + NestJS module init enough time (remote PostgreSQL
//     first handshake + DBOS sysdb migration + LISTEN/NOTIFY registration may also be delayed by transient network jitter).
//   - teardownTimeout: 60s for afterAll's module.close + DBOS.shutdown + DROP SCHEMA + pool.end().

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
    include: ['test/dbos/**/*.spec.ts', 'src/**/*.integration.spec.ts'],
    exclude: ['test/e2e/**', 'node_modules/**', 'dist/**'],
    pool: 'forks',
    forks: { singleFork: true },
    fileParallelism: false,
    sequence: { concurrent: false },
    setupFiles: ['reflect-metadata'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    teardownTimeout: 60_000,
    passWithNoTests: true,
  },
});
