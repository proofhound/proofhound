// DBOS workflow integration test helper — focus: verifying the ExperimentWorkflow state machine
//
// Usage:
//   - Start local PostgreSQL: pnpm dev:docker:ready
//   - export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/proofhound"
//   - pnpm -F @proofhound/server test:integration
//
// Design:
//   - Does not create separate schemas; writes directly into the real ph_core / ph_assets / ph_runs.
//   - Per-case data is inserted via fixture factories; after trackExperiment(seeded), afterEach cleans up precisely.
//   - BullmqService is mocked, does not connect to Redis; the mock immediately writes the run_result to ph_runs.run_results
//     to simulate worker completion, so the workflow's pollUntilBatchDone is satisfied immediately.
//   - Does not load AppModule / Guard / Controller; only loads ExperimentWorkflowRegistrar + RunResultService.

// Integration tests default to debug level (for diagnosing state machine steps); the application only emits JSON,
// run `pnpm test:integration 2>&1 | pino-pretty` manually for human-friendly output.
// Must be set before importing @proofhound/logger (the logger reads env at import time).
process.env['LOG_LEVEL'] ??= 'debug';

import { randomBytes } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createDbClient, schema, type DbClient } from '@proofhound/db';
import { createLogger } from '@proofhound/logger';
import { inArray, like, sql } from 'drizzle-orm';
import { DATABASE_CLIENT } from '../../src/shared/database/database.constants';
import { BullmqService } from '../../src/server/infrastructure/orchestration/bullmq.service';
import { LOCAL_ACTOR_ID } from '../../src/server/common/actor-context';
import { ExperimentWorkflowRegistrar } from '../../src/server/modules/experiment/experiment.workflow';
import { RunResultRepository } from '../../src/server/modules/run-result/run-result.repository';
import { RunResultService } from '../../src/server/modules/run-result/run-result.service';
import { MockBullmqService } from './bullmq.mock';
import type { SeededExperiment } from './fixtures/experiment-fixture';

const setupLogger = createLogger('dbos-test.setup', { service: 'integration-test' });

const { runResults, experiments, promptVersions, prompts, datasetSamples, datasets, models } = schema;

export interface DbosTestContext {
  databaseUrl: string;
  db: DbClient;
  registrar: ExperimentWorkflowRegistrar;
  bullmq: MockBullmqService;
  testUserId: string;
  trackExperiment(seed: SeededExperiment): void;
  cleanupTrackedExperiments(): Promise<void>;
}

export function getTestDatabaseUrl(): string | null {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url || url.length === 0) return null;
  return url;
}

export function describeDbosIntegration(name: string, fn: (getCtx: () => DbosTestContext) => void): void {
  const url = getTestDatabaseUrl();
  if (!url) {
    describe.skip(`${name} (skipped: TEST_DATABASE_URL not set)`, () => {
      it.skip('integration test requires TEST_DATABASE_URL', () => undefined);
    });
    return;
  }

  describe(name, () => {
    const ctxRef: { current: DbosTestContext | null } = { current: null };
    const trackedExperiments = new Map<string, SeededExperiment>();
    let module: TestingModule | null = null;
    let sysSchema: string | null = null;
    let dbRef: DbClient | null = null;

    beforeAll(async () => {
      const suite = randomBytes(4).toString('hex');
      sysSchema = `dbos_test_${suite}`;
      setupLogger.info({ suite, sysSchema }, 'integration_suite_init');
      const db = createDbClient(url);
      dbRef = db;

      // Backstop: first clean up dbos-test-* business projects and dangling dbos_test_* schemas left by previously interrupted vitest runs
      // (afterEach / afterAll may leak when Ctrl+C or a worker crash prevents them from finishing)
      await cleanupStaleResidue(db);

      const testUserId = LOCAL_ACTOR_ID;

      // Schema-level isolation: during tests, DBOS system tables (workflow_status / operation_outputs, etc.)
      // are all written to the dbos_test_<suite> schema, fully isolated from the production default dbos schema.
      // afterAll runs DROP SCHEMA CASCADE in one shot, no longer dirtying production tables.
      DBOS.setConfig({
        name: `dbos-test-${suite}`,
        systemDatabaseUrl: url,
        systemDatabaseSchemaName: sysSchema,
        runAdminServer: false,
      });

      const mockBullmq = new MockBullmqService(db);

      // compile() must run before DBOS.launch(): when NestJS instantiates ExperimentWorkflowRegistrar,
      // its constructor calls DBOS.registerStep / registerWorkflow; the DBOS SDK requires "register before launch".
      // In the production path, NestFactory.create instantiates all providers first; onModuleInit runs DBOS.launch later, naturally satisfying the order.
      module = await Test.createTestingModule({
        providers: [
          { provide: DATABASE_CLIENT, useValue: db },
          { provide: BullmqService, useValue: mockBullmq },
          RunResultRepository,
          RunResultService,
          ExperimentWorkflowRegistrar,
        ],
      }).compile();

      await DBOS.launch();
      setupLogger.debug({ suite, testUserId }, 'dbos_launched');

      await module.init();

      const registrar = module.get(ExperimentWorkflowRegistrar);

      ctxRef.current = {
        databaseUrl: url,
        db,
        registrar,
        bullmq: mockBullmq,
        testUserId,
        trackExperiment(seed: SeededExperiment) {
          trackedExperiments.set(seed.experimentId, seed);
        },
        async cleanupTrackedExperiments() {
          if (trackedExperiments.size === 0) return;
          const seeds = Array.from(trackedExperiments.values());
          const experimentIds = seeds.map((seed) => seed.experimentId);
          const promptVersionIds = seeds.map((seed) => seed.promptVersionId);
          const promptIds = seeds.map((seed) => seed.promptId);
          const datasetIds = seeds.map((seed) => seed.datasetId);
          const modelIds = seeds.map((seed) => seed.modelId);
          const sampleIds = seeds.flatMap((seed) => seed.sampleIds);

          setupLogger.debug({ experimentIds }, 'cleanup_tracked_experiments');
          await db.delete(runResults).where(inArray(runResults.sourceId, experimentIds));
          await db.delete(experiments).where(inArray(experiments.id, experimentIds));
          if (sampleIds.length > 0) {
            await db.delete(datasetSamples).where(inArray(datasetSamples.id, sampleIds));
          }
          await db.delete(promptVersions).where(inArray(promptVersions.id, promptVersionIds));
          await db.delete(prompts).where(inArray(prompts.id, promptIds));
          await db.delete(datasets).where(inArray(datasets.id, datasetIds));
          await db.delete(models).where(inArray(models.id, modelIds));
          trackedExperiments.clear();
        },
      };
      setupLogger.info({}, 'integration_suite_ready');
    }, 60_000);

    beforeEach(() => {
      const state = expect.getState();
      setupLogger.info({ testName: state.currentTestName }, 'integration_case_start');
    });

    afterEach(async () => {
      const state = expect.getState();
      ctxRef.current?.bullmq.reset();
      await ctxRef.current?.cleanupTrackedExperiments();
      setupLogger.info({ testName: state.currentTestName }, 'integration_case_end');
    });

    afterAll(async () => {
      try {
        await module?.close();
      } catch {
        // ignore
      }
      try {
        await DBOS.shutdown();
      } catch {
        // ignore
      }
      // Close the connection pool after shutdown so DROP SCHEMA can succeed (otherwise tables in the schema still have connection locks)
      if (dbRef && sysSchema) {
        try {
          await dbRef.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(sysSchema)} CASCADE`);
          setupLogger.info({ sysSchema }, 'integration_suite_dropped_sys_schema');
        } catch (err) {
          setupLogger.warn({ sysSchema, err: (err as Error).message }, 'drop_sysdb_schema_failed');
        }
      }
      // Finally, explicitly close the postgres-js connection pool to avoid prolonged process exit due to leftover idle connections
      // (the old jest run hung for 14 minutes precisely because this was not closed).
      if (dbRef) {
        try {
          await (dbRef as unknown as { $client: { end: (opts?: { timeout?: number }) => Promise<void> } }).$client.end({
            timeout: 5,
          });
        } catch {
          // ignore
        }
      }
      setupLogger.info({}, 'integration_suite_done');
    }, 30_000);

    fn(() => {
      if (!ctxRef.current) throw new Error('integration context not initialised');
      return ctxRef.current;
    });
  });
}

// Backstop cleanup of test leftovers from previously interrupted vitest runs (Ctrl+C / worker crash leaving afterEach/afterAll unfinished).
// Cross-suite shared: the first suite to run catches it in beforeAll; subsequent suites find nothing.
// Already serialized via vitest.integration.config.ts's fileParallelism: false + singleFork; will not collide with suites running in parallel.
async function cleanupStaleResidue(db: DbClient): Promise<void> {
  // 1. Business tables: clean up local test resources by fixture prefix from previous interruptions.
  const staleExperiments = await db
    .select({ id: experiments.id })
    .from(experiments)
    .where(like(experiments.name, 'dbos-test-%'));
  if (staleExperiments.length > 0) {
    const ids = staleExperiments.map((r) => r.id);
    await db.delete(runResults).where(inArray(runResults.sourceId, ids));
    await db.delete(experiments).where(inArray(experiments.id, ids));
  }

  const stalePrompts = await db.select({ id: prompts.id }).from(prompts).where(like(prompts.name, 'dbos-test-%'));
  if (stalePrompts.length > 0) {
    const ids = stalePrompts.map((r) => r.id);
    await db.delete(prompts).where(inArray(prompts.id, ids));
  }

  const staleDatasets = await db.select({ id: datasets.id }).from(datasets).where(like(datasets.name, 'dbos-test-%'));
  if (staleDatasets.length > 0) {
    const ids = staleDatasets.map((r) => r.id);
    await db.delete(datasets).where(inArray(datasets.id, ids));
  }

  const staleModels = await db.select({ id: models.id }).from(models).where(like(models.name, 'dbos-test-%'));
  if (staleModels.length > 0) {
    const ids = staleModels.map((r) => r.id);
    await db.delete(models).where(inArray(models.id, ids));
  }

  const staleCount = staleExperiments.length + stalePrompts.length + staleDatasets.length + staleModels.length;
  if (staleCount > 0) {
    setupLogger.info({ count: staleCount }, 'cleanup_stale_test_resources');
  }

  // 2. DBOS system database: scan and DROP all dangling dbos_test_* schemas
  const rawRows = await db.execute(sql`
    SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'dbos_test_%'
  `);
  const rows: Array<{ schema_name: string }> = Array.isArray(rawRows)
    ? (rawRows as unknown as Array<{ schema_name: string }>)
    : ((rawRows as unknown as { rows?: Array<{ schema_name: string }> }).rows ?? []);
  for (const row of rows) {
    await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(row.schema_name)} CASCADE`);
  }
  if (rows.length > 0) {
    setupLogger.info({ count: rows.length, schemas: rows.map((r) => r.schema_name) }, 'cleanup_stale_sys_schemas');
  }
}
