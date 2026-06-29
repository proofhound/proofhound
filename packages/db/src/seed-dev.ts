/**
 * Dev seed: writes the current dev environment's local data snapshot.
 *
 * The OSS self-hosted edition creates a single local project as the data boundary; it does not create members, roles, platform connectors, or org governance data.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { encryptApiKey } from '@proofhound/crypto';
import { LOCAL_PROJECT_ID } from '@proofhound/shared';
import { and, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { createDbClient } from './client';
import {
  annotations,
  annotationTasks,
  connectors,
  datasetSamples,
  datasets,
  experiments,
  models,
  optimizationRoundSteps,
  optimizations,
  promptVersionLabels,
  prompts,
  promptVersions,
  projects,
  releaseLineEvents,
  releaseLines,
  releaseVersions,
  runResultIds,
  runResults,
  tokens,
} from './schema';
import { DEV_TOKENS } from './fixtures/dev/tokens';
import { DEV_CONNECTORS } from './fixtures/dev/connectors';
import { DEV_EXPERIMENTS, DEV_EXPERIMENT_DATASETS } from './fixtures/dev/experiments';
import { DEV_MODELS } from './fixtures/dev/models';
import { DEV_OPTIMIZATIONS, DEV_OPTIMIZATION_ROUND_STEPS } from './fixtures/dev/optimizations';
import { DEV_PROMPTS } from './fixtures/dev/prompts';
import {
  DEV_RELEASE_ANNOTATIONS,
  DEV_RELEASE_ANNOTATION_TASKS,
  DEV_RELEASE_EVENTS,
  DEV_RELEASE_LINES,
  DEV_RELEASE_RUN_RESULTS,
  DEV_RELEASE_VERSIONS,
} from './fixtures/dev/releases';

const PRODUCTION_ENV_NAMES = new Set(['prod', 'production']);
const DEV_MODEL_API_KEY_PLACEHOLDER = 'dev-seed-placeholder-api-key';
const LOCAL_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

function getCurrentEnvironment(): string {
  return (process.env['APP_ENV'] ?? process.env['NODE_ENV'] ?? 'development').toLowerCase();
}

function getConnectorShape(kind: string): { direction: 'input' | 'output'; type: 'redis' | 'kafka' | 'webhook' } {
  if (kind === 'webhook-input') return { direction: 'input', type: 'webhook' };
  return {
    direction: kind.endsWith('-input') ? 'input' : 'output',
    type: kind.startsWith('redis-') ? 'redis' : 'kafka',
  };
}

async function setPromptVersionsFreezeGuard(
  executor: { execute(query: SQL): Promise<unknown> },
  mode: 'disable' | 'enable',
): Promise<void> {
  await executor.execute(
    mode === 'disable'
      ? sql`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM pg_trigger
              WHERE tgrelid = 'ph_assets.prompt_versions'::regclass
                AND tgname = 'prompt_versions_freeze_guard'
                AND NOT tgisinternal
            ) THEN
              EXECUTE 'ALTER TABLE ph_assets.prompt_versions DISABLE TRIGGER prompt_versions_freeze_guard';
            END IF;
          END $$;
        `
      : sql`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM pg_trigger
              WHERE tgrelid = 'ph_assets.prompt_versions'::regclass
                AND tgname = 'prompt_versions_freeze_guard'
                AND NOT tgisinternal
            ) THEN
              EXECUTE 'ALTER TABLE ph_assets.prompt_versions ENABLE TRIGGER prompt_versions_freeze_guard';
            END IF;
          END $$;
        `,
  );
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(resolve(process.cwd(), '../../.env'));
  } catch {
    // OK in CI.
  }

  if (process.env['SEED_PROFILE'] !== 'dev' && process.env['ALLOW_DEV_SEED'] !== 'true') {
    console.error('❌  Dev seed must be explicitly enabled: SEED_PROFILE=dev pnpm db:seed:dev');
    process.exit(1);
  }

  const currentEnvironment = getCurrentEnvironment();
  if (process.env['ALLOW_DEV_SEED'] !== 'true' && PRODUCTION_ENV_NAMES.has(currentEnvironment)) {
    console.error(`❌  Dev seed refuses to write to the ${currentEnvironment} environment`);
    console.error('    If you really need to write, explicitly set ALLOW_DEV_SEED=true');
    process.exit(1);
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('❌  DATABASE_URL must be configured');
    process.exit(1);
  }

  const modelApiKeyEncryptionKey = process.env['MODEL_API_KEY_ENCRYPTION_KEY'];
  const db = createDbClient(databaseUrl);

  console.warn(`\n🌱  Writing the dev data snapshot to the ${currentEnvironment} environment as the local actor`);

  await db
    .insert(projects)
    .values({
      id: LOCAL_PROJECT_ID,
      name: 'Local Project',
      description: 'Self-hosted single-project data boundary',
      type: 'classification',
      status: 'active',
      createdBy: LOCAL_ACTOR_ID,
    })
    .onConflictDoUpdate({
      target: projects.id,
      set: {
        name: 'Local Project',
        description: 'Self-hosted single-project data boundary',
        type: 'classification',
        status: 'active',
        archivedAt: null,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });

  const fixtureDatasetIds = DEV_EXPERIMENT_DATASETS.map((d) => d.id);
  const fixtureModelIds = DEV_MODELS.map((m) => m.id);
  const fixturePromptIds = DEV_PROMPTS.map((p) => p.id);
  const fixtureExperimentIds = DEV_EXPERIMENTS.map((e) => e.id);
  const fixtureOptimizationIds = DEV_OPTIMIZATIONS.map((a) => a.id);
  const fixtureConnectorIds = DEV_CONNECTORS.map((c) => c.id);
  const fixtureReleaseLineIds = DEV_RELEASE_LINES.map((line) => line.id);
  const fixtureReleaseVersionIds = DEV_RELEASE_VERSIONS.map((version) => version.id);
  const fixtureReleaseEventIds = DEV_RELEASE_EVENTS.map((event) => event.id);

  await db.delete(annotations);
  await db.delete(runResults);
  await db.delete(annotationTasks);
  await db.delete(releaseLineEvents).where(notInArray(releaseLineEvents.id, fixtureReleaseEventIds));
  await db.update(releaseVersions).set({ promotedFromReleaseVersionId: null });
  await db.delete(releaseVersions).where(notInArray(releaseVersions.id, fixtureReleaseVersionIds));
  await db.delete(releaseLines).where(notInArray(releaseLines.id, fixtureReleaseLineIds));
  await db.delete(optimizationRoundSteps);
  await db
    .update(optimizations)
    .set({ sourceExperimentId: null, updatedAt: new Date() })
    .where(notInArray(optimizations.id, fixtureOptimizationIds));
  await db
    .update(experiments)
    .set({ optimizationId: null, roundIndex: null, updatedAt: new Date() })
    .where(sql`${experiments.optimizationId} IS NOT NULL`);
  await db.delete(experiments).where(notInArray(experiments.id, fixtureExperimentIds));
  await db.delete(optimizations).where(notInArray(optimizations.id, fixtureOptimizationIds));

  await db.transaction(async (tx) => {
    await setPromptVersionsFreezeGuard(tx, 'disable');
    await tx.delete(promptVersionLabels);
    await tx.delete(promptVersions).where(notInArray(promptVersions.promptId, fixturePromptIds));
    await tx.delete(prompts).where(notInArray(prompts.id, fixturePromptIds));
    await setPromptVersionsFreezeGuard(tx, 'enable');
  });

  await db.delete(datasetSamples).where(notInArray(datasetSamples.datasetId, fixtureDatasetIds));
  await db.delete(datasets).where(notInArray(datasets.id, fixtureDatasetIds));
  await db.delete(connectors).where(notInArray(connectors.id, fixtureConnectorIds));
  await db.delete(models).where(notInArray(models.id, fixtureModelIds));

  let seededDevModels = false;

  if (!modelApiKeyEncryptionKey) {
    const existingDevModels = await db
      .select({ id: models.id })
      .from(models)
      .where(
        inArray(
          models.id,
          DEV_MODELS.map((fixture) => fixture.id),
        ),
      );

    if (existingDevModels.length === DEV_MODELS.length) {
      console.warn('⚠️  MODEL_API_KEY_ENCRYPTION_KEY is not configured; reusing existing model data');
      seededDevModels = true;
    } else {
      console.warn('⚠️  Skipping model data: MODEL_API_KEY_ENCRYPTION_KEY is not configured');
    }
  } else {
    let warnedMissingModelProbeKey = false;

    for (const fixture of DEV_MODELS) {
      const rawApiKey = process.env['MODEL_PROBE_API_KEY']?.trim();
      const apiKey = rawApiKey && rawApiKey.length > 0 ? rawApiKey : DEV_MODEL_API_KEY_PLACEHOLDER;
      const apiKeyEncrypted = encryptApiKey(apiKey, modelApiKeyEncryptionKey);

      if (apiKey === DEV_MODEL_API_KEY_PLACEHOLDER && !warnedMissingModelProbeKey) {
        console.warn('⚠️  MODEL_PROBE_API_KEY is not configured; model connectivity tests using the placeholder credential will fail');
        warnedMissingModelProbeKey = true;
      }

      await db
        .insert(models)
        .values({
          id: fixture.id,
          projectId: LOCAL_PROJECT_ID,
          name: fixture.name,
          providerType: fixture.providerType,
          providerModelId: fixture.providerModelId,
          endpoint: fixture.endpoint,
          apiKeyEncrypted,
          contextWindowTokens: fixture.contextWindowTokens,
          rpmLimit: fixture.rpmLimit,
          tpmLimit: fixture.tpmLimit,
          concurrencyLimit: fixture.concurrencyLimit,
          inputTokenPricePerMillion: fixture.inputTokenPricePerMillion,
          outputTokenPricePerMillion: fixture.outputTokenPricePerMillion,
          capabilities: fixture.capabilities,
          extraBody: fixture.extraBody ?? {},
          isActive: fixture.isActive,
          lastProbedAt: null,
          lastProbeError: null,
          createdBy: LOCAL_ACTOR_ID,
        })
        .onConflictDoUpdate({
          target: models.id,
          set: {
            name: fixture.name,
            projectId: LOCAL_PROJECT_ID,
            providerType: fixture.providerType,
            providerModelId: fixture.providerModelId,
            endpoint: fixture.endpoint,
            apiKeyEncrypted,
            contextWindowTokens: fixture.contextWindowTokens,
            rpmLimit: fixture.rpmLimit,
            tpmLimit: fixture.tpmLimit,
            concurrencyLimit: fixture.concurrencyLimit,
            inputTokenPricePerMillion: fixture.inputTokenPricePerMillion,
            outputTokenPricePerMillion: fixture.outputTokenPricePerMillion,
            capabilities: fixture.capabilities,
            extraBody: fixture.extraBody ?? {},
            isActive: fixture.isActive,
            deletedAt: null,
            updatedAt: new Date(),
          },
        });
    }

    console.warn(`✅  Model data ready: ${DEV_MODELS.length} models`);
    seededDevModels = true;
  }

  // The connector must be written before the webhook token: the webhook token is reverse-linked via the foreign key connector_id
  // (ph_core.tokens, scope='webhook' AND connector_id=<connector.id>); see docs/specs/06-database-schema.md §3.2 / §4.5
  for (const fixture of DEV_CONNECTORS) {
    const shape = getConnectorShape(fixture.kind);
    await db
      .insert(connectors)
      .values({
        id: fixture.id,
        projectId: LOCAL_PROJECT_ID,
        name: fixture.name,
        description: fixture.description,
        direction: shape.direction,
        type: shape.type,
        config: fixture.config,
        configEncrypted: null,
        webhookPath: fixture.kind === 'webhook-input' ? fixture.webhookPath : null,
        ipWhitelist: null,
        createdBy: LOCAL_ACTOR_ID,
      })
      .onConflictDoUpdate({
        target: connectors.id,
        set: {
          name: fixture.name,
          projectId: LOCAL_PROJECT_ID,
          description: fixture.description,
          direction: shape.direction,
          type: shape.type,
          config: fixture.config,
          configEncrypted: null,
          webhookPath: fixture.kind === 'webhook-input' ? fixture.webhookPath : null,
          ipWhitelist: null,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });
  }
  console.warn(`✅  Connector data ready: ${DEV_CONNECTORS.length} records`);

  for (const fixture of DEV_TOKENS) {
    const tokenHash = createHash('sha256').update(fixture.plaintext).digest('hex');
    await db
      .insert(tokens)
      .values({
        id: fixture.id,
        scope: 'webhook',
        projectId: LOCAL_PROJECT_ID,
        connectorId: fixture.connectorId,
        name: fixture.name,
        tokenHash,
        prefix: fixture.prefix,
        ipWhitelist: null,
        createdBy: LOCAL_ACTOR_ID,
      })
      .onConflictDoUpdate({
        target: tokens.id,
        set: {
          scope: 'webhook',
          projectId: LOCAL_PROJECT_ID,
          connectorId: fixture.connectorId,
          name: fixture.name,
          tokenHash,
          prefix: fixture.prefix,
          revokedAt: null,
        },
      });
  }
  console.warn(`✅  Connector webhook token data ready: ${DEV_TOKENS.length} records`);

  for (const fixture of DEV_EXPERIMENT_DATASETS) {
    if (fixture.sampleCount !== fixture.samples.length) {
      console.error(
        `❌  Dataset ${fixture.name} sampleCount=${fixture.sampleCount} does not match the actual sample count ${fixture.samples.length}`,
      );
      process.exit(1);
    }

    await db
      .insert(datasets)
      .values({
        id: fixture.id,
        projectId: LOCAL_PROJECT_ID,
        name: fixture.name,
        description: fixture.description,
        sampleCount: fixture.sampleCount,
        fieldSchema: fixture.fieldSchema,
        hasImages: fixture.hasImages,
        createdBy: LOCAL_ACTOR_ID,
        createdAt: new Date(fixture.createdAt),
        updatedAt: new Date(fixture.updatedAt),
      })
      .onConflictDoUpdate({
        target: datasets.id,
        set: {
          name: fixture.name,
          projectId: LOCAL_PROJECT_ID,
          description: fixture.description,
          sampleCount: fixture.sampleCount,
          fieldSchema: fixture.fieldSchema,
          hasImages: fixture.hasImages,
          deletedAt: null,
          updatedAt: new Date(fixture.updatedAt),
        },
      });

    const fixtureSampleIds = fixture.samples.map((sample) => sample.id);
    await db
      .delete(datasetSamples)
      .where(
        fixtureSampleIds.length === 0
          ? eq(datasetSamples.datasetId, fixture.id)
          : and(eq(datasetSamples.datasetId, fixture.id), notInArray(datasetSamples.id, fixtureSampleIds)),
      );

    for (const sample of fixture.samples) {
      await db
        .insert(datasetSamples)
        .values({
          id: sample.id,
          datasetId: fixture.id,
          data: sample.data,
          externalId: sample.externalId,
          createdAt: new Date(sample.createdAt),
          updatedAt: new Date(sample.updatedAt),
        })
        .onConflictDoUpdate({
          target: datasetSamples.id,
          set: {
            datasetId: fixture.id,
            data: sample.data,
            externalId: sample.externalId,
            updatedAt: new Date(sample.updatedAt),
          },
        });
    }
  }
  console.warn(`✅  Dataset data ready: ${DEV_EXPERIMENT_DATASETS.length} datasets`);

  await db.transaction(async (tx) => {
    await setPromptVersionsFreezeGuard(tx, 'disable');

    for (const fixture of DEV_PROMPTS) {
      await tx
        .insert(prompts)
        .values({
          id: fixture.id,
          projectId: LOCAL_PROJECT_ID,
          name: fixture.name,
          currentOnlineVersionId: fixture.currentOnlineVersionId,
          defaultDatasetId: fixture.defaultDatasetId ?? null,
          createdBy: LOCAL_ACTOR_ID,
          createdAt: new Date(fixture.createdAt),
          updatedAt: new Date(fixture.updatedAt),
        })
        .onConflictDoUpdate({
          target: prompts.id,
          set: {
            name: fixture.name,
            projectId: LOCAL_PROJECT_ID,
            currentOnlineVersionId: fixture.currentOnlineVersionId,
            defaultDatasetId: fixture.defaultDatasetId ?? null,
            deletedAt: null,
            updatedAt: new Date(fixture.updatedAt),
          },
        });

      for (const version of fixture.versions) {
        const frozenAt = version.frozenAt ? new Date(version.frozenAt) : null;

        await tx
          .insert(promptVersions)
          .values({
            id: version.id,
            promptId: fixture.id,
            versionNumber: version.versionNumber,
            body: version.body,
            variables: version.variables,
            outputSchema: version.outputSchema,
            judgmentRules: version.judgmentRules,
            promptLanguage: version.promptLanguage,
            parentVersionId: version.parentVersionId,
            generatedByOptimizationId: version.generatedByOptimizationId,
            changeReason: version.changeReason,
            isFrozen: version.isFrozen,
            createdAt: new Date(version.createdAt),
            frozenAt,
            createdBy: LOCAL_ACTOR_ID,
          })
          .onConflictDoUpdate({
            target: promptVersions.id,
            set: {
              versionNumber: version.versionNumber,
              body: version.body,
              variables: version.variables,
              outputSchema: version.outputSchema,
              judgmentRules: version.judgmentRules,
              promptLanguage: version.promptLanguage,
              parentVersionId: version.parentVersionId,
              generatedByOptimizationId: version.generatedByOptimizationId,
              changeReason: version.changeReason,
              isFrozen: version.isFrozen,
              createdAt: new Date(version.createdAt),
              frozenAt,
            },
          });
      }

      const fixtureVersionIds = fixture.versions.map((version) => version.id);
      await tx
        .delete(promptVersions)
        .where(
          fixtureVersionIds.length === 0
            ? eq(promptVersions.promptId, fixture.id)
            : and(eq(promptVersions.promptId, fixture.id), notInArray(promptVersions.id, fixtureVersionIds)),
        );
    }

    await setPromptVersionsFreezeGuard(tx, 'enable');
  });
  console.warn(`✅  Prompt data ready: ${DEV_PROMPTS.length} prompts`);

  if (!seededDevModels) {
    console.warn('⚠️  Skipping experiment / optimization data: experiments require model data to be written first');
    process.exit(0);
  }

  async function upsertExperiment(fixture: (typeof DEV_EXPERIMENTS)[number]): Promise<void> {
    await db
      .insert(experiments)
      .values({
        id: fixture.id,
        projectId: LOCAL_PROJECT_ID,
        name: fixture.name,
        promptVersionId: fixture.promptVersionId,
        datasetId: fixture.datasetId,
        modelId: fixture.modelId,
        optimizationId: fixture.optimizationId,
        roundIndex: fixture.roundIndex,
        status: fixture.status,
        runConfig: fixture.runConfig,
        dbosWorkflowId: fixture.dbosWorkflowId,
        controlState: fixture.controlState,
        totalSamples: fixture.totalSamples,
        processedSamples: fixture.processedSamples,
        failedSamples: fixture.failedSamples,
        metrics: fixture.metrics,
        failureKind: fixture.failureKind,
        failureReason: fixture.failureReason,
        startedAt: fixture.startedAt ? new Date(fixture.startedAt) : null,
        finishedAt: fixture.finishedAt ? new Date(fixture.finishedAt) : null,
        createdBy: LOCAL_ACTOR_ID,
        createdAt: new Date(fixture.createdAt),
        updatedAt: new Date(fixture.updatedAt),
      })
      .onConflictDoUpdate({
        target: experiments.id,
        set: {
          name: fixture.name,
          projectId: LOCAL_PROJECT_ID,
          promptVersionId: fixture.promptVersionId,
          datasetId: fixture.datasetId,
          modelId: fixture.modelId,
          optimizationId: fixture.optimizationId,
          roundIndex: fixture.roundIndex,
          status: fixture.status,
          runConfig: fixture.runConfig,
          dbosWorkflowId: fixture.dbosWorkflowId,
          controlState: fixture.controlState,
          totalSamples: fixture.totalSamples,
          processedSamples: fixture.processedSamples,
          failedSamples: fixture.failedSamples,
          metrics: fixture.metrics,
          failureKind: fixture.failureKind,
          failureReason: fixture.failureReason,
          startedAt: fixture.startedAt ? new Date(fixture.startedAt) : null,
          finishedAt: fixture.finishedAt ? new Date(fixture.finishedAt) : null,
          deletedAt: null,
          updatedAt: new Date(fixture.updatedAt),
        },
      });
  }

  for (const fixture of DEV_EXPERIMENTS.filter((experiment) => experiment.optimizationId === null)) {
    await upsertExperiment(fixture);
  }

  for (const fixture of DEV_OPTIMIZATIONS) {
    await db
      .insert(optimizations)
      .values({
        id: fixture.id,
        projectId: LOCAL_PROJECT_ID,
        name: fixture.name,
        description: fixture.description,
        optimizationHint: fixture.optimizationHint,
        strategy: fixture.strategy,
        strategyConfig: fixture.strategyConfig,
        startingMode: fixture.startingMode,
        sourceExperimentId: fixture.sourceExperimentId,
        promptId: fixture.promptId,
        baseVersionId: fixture.baseVersionId,
        datasetId: fixture.datasetId,
        experimentModelId: fixture.experimentModelId,
        analysisModelId: fixture.analysisModelId,
        promptLanguage: fixture.promptLanguage,
        status: fixture.status,
        dbosWorkflowId: fixture.dbosWorkflowId,
        controlState: fixture.controlState,
        goals: fixture.goals,
        fieldWhitelist: fixture.fieldWhitelist,
        runConfig: fixture.runConfig,
        maxRounds: fixture.maxRounds,
        currentRound: fixture.currentRound,
        bestVersionId: fixture.bestVersionId,
        bestMetrics: fixture.bestMetrics,
        summary: fixture.summary,
        analysisFailureReason: fixture.analysisFailureReason,
        startedAt: fixture.startedAt ? new Date(fixture.startedAt) : null,
        finishedAt: fixture.finishedAt ? new Date(fixture.finishedAt) : null,
        createdBy: LOCAL_ACTOR_ID,
        createdAt: new Date(fixture.createdAt),
        updatedAt: new Date(fixture.updatedAt),
      })
      .onConflictDoUpdate({
        target: optimizations.id,
        set: {
          name: fixture.name,
          projectId: LOCAL_PROJECT_ID,
          description: fixture.description,
          optimizationHint: fixture.optimizationHint,
          strategy: fixture.strategy,
          strategyConfig: fixture.strategyConfig,
          startingMode: fixture.startingMode,
          sourceExperimentId: fixture.sourceExperimentId,
          promptId: fixture.promptId,
          baseVersionId: fixture.baseVersionId,
          datasetId: fixture.datasetId,
          experimentModelId: fixture.experimentModelId,
          analysisModelId: fixture.analysisModelId,
          promptLanguage: fixture.promptLanguage,
          status: fixture.status,
          dbosWorkflowId: fixture.dbosWorkflowId,
          controlState: fixture.controlState,
          goals: fixture.goals,
          fieldWhitelist: fixture.fieldWhitelist,
          runConfig: fixture.runConfig,
          maxRounds: fixture.maxRounds,
          currentRound: fixture.currentRound,
          bestVersionId: fixture.bestVersionId,
          bestMetrics: fixture.bestMetrics,
          summary: fixture.summary,
          analysisFailureReason: fixture.analysisFailureReason,
          startedAt: fixture.startedAt ? new Date(fixture.startedAt) : null,
          finishedAt: fixture.finishedAt ? new Date(fixture.finishedAt) : null,
          deletedAt: null,
          updatedAt: new Date(fixture.updatedAt),
        },
      });
  }

  for (const fixture of DEV_EXPERIMENTS.filter((experiment) => experiment.optimizationId !== null)) {
    await upsertExperiment(fixture);
  }
  console.warn(`✅  Experiment data ready: ${DEV_EXPERIMENTS.length} experiments`);

  for (const fixture of DEV_OPTIMIZATION_ROUND_STEPS) {
    await db
      .insert(optimizationRoundSteps)
      .values({
        id: fixture.id,
        optimizationId: fixture.optimizationId,
        roundIndex: fixture.roundIndex,
        step: fixture.step,
        status: fixture.status,
        errorClass: fixture.errorClass,
        errorMessage: fixture.errorMessage,
        runResultId: fixture.runResultId,
        experimentId: fixture.experimentId,
        startedAt: fixture.startedAt ? new Date(fixture.startedAt) : null,
        finishedAt: fixture.finishedAt ? new Date(fixture.finishedAt) : null,
        attempt: fixture.attempt,
        dbosWorkflowId: fixture.dbosWorkflowId,
        createdAt: new Date(fixture.createdAt),
        updatedAt: new Date(fixture.updatedAt),
      })
      .onConflictDoUpdate({
        target: optimizationRoundSteps.id,
        set: {
          optimizationId: fixture.optimizationId,
          roundIndex: fixture.roundIndex,
          step: fixture.step,
          status: fixture.status,
          errorClass: fixture.errorClass,
          errorMessage: fixture.errorMessage,
          runResultId: fixture.runResultId,
          experimentId: fixture.experimentId,
          startedAt: fixture.startedAt ? new Date(fixture.startedAt) : null,
          finishedAt: fixture.finishedAt ? new Date(fixture.finishedAt) : null,
          attempt: fixture.attempt,
          dbosWorkflowId: fixture.dbosWorkflowId,
          updatedAt: new Date(fixture.updatedAt),
        },
      });
  }
  console.warn(`✅  Optimization data ready: ${DEV_OPTIMIZATIONS.length} optimizations, ${DEV_OPTIMIZATION_ROUND_STEPS.length} steps`);

  for (const fixture of DEV_RELEASE_LINES) {
    await db
      .insert(releaseLines)
      .values({
        id: fixture.id,
        projectId: LOCAL_PROJECT_ID,
        name: fixture.name,
        description: fixture.description,
        promptId: fixture.promptId,
        promptName: fixture.promptName,
        promptSnapshot: fixture.promptSnapshot,
        inputConnectorId: fixture.inputConnectorId,
        inputConnectorName: fixture.inputConnectorName,
        inputConnectorType: fixture.inputConnectorType,
        inputConnectorSnapshot: fixture.inputConnectorSnapshot,
        status: fixture.status,
        currentProductionEventId: fixture.currentProductionEventId,
        activeCanaryEventId: fixture.activeCanaryEventId,
        createdBy: LOCAL_ACTOR_ID,
        createdAt: new Date(fixture.createdAt),
        updatedAt: new Date(fixture.updatedAt),
        archivedAt: null,
      })
      .onConflictDoUpdate({
        target: releaseLines.id,
        set: {
          projectId: LOCAL_PROJECT_ID,
          name: fixture.name,
          description: fixture.description,
          promptId: fixture.promptId,
          promptName: fixture.promptName,
          promptSnapshot: fixture.promptSnapshot,
          inputConnectorId: fixture.inputConnectorId,
          inputConnectorName: fixture.inputConnectorName,
          inputConnectorType: fixture.inputConnectorType,
          inputConnectorSnapshot: fixture.inputConnectorSnapshot,
          status: fixture.status,
          currentProductionEventId: fixture.currentProductionEventId,
          activeCanaryEventId: fixture.activeCanaryEventId,
          updatedAt: new Date(fixture.updatedAt),
          archivedAt: null,
        },
      });
  }

  for (const fixture of DEV_RELEASE_VERSIONS) {
    await db
      .insert(releaseVersions)
      .values({
        id: fixture.id,
        projectId: LOCAL_PROJECT_ID,
        releaseLineId: fixture.releaseLineId,
        kind: fixture.kind,
        productionVersionNumber: fixture.productionVersionNumber,
        targetProductionVersionNumber: fixture.targetProductionVersionNumber,
        candidateNumber: fixture.candidateNumber,
        promotedFromReleaseVersionId: fixture.promotedFromReleaseVersionId,
        promptId: fixture.promptId,
        promptName: fixture.promptName,
        promptVersionId: fixture.promptVersionId,
        promptVersionNumber: fixture.promptVersionNumber,
        promptSnapshot: fixture.promptSnapshot,
        promptVersionSnapshot: fixture.promptVersionSnapshot,
        modelId: fixture.modelId,
        modelSnapshot: fixture.modelSnapshot,
        createdBy: LOCAL_ACTOR_ID,
        createdAt: new Date(fixture.createdAt),
        updatedAt: new Date(fixture.updatedAt),
      })
      .onConflictDoUpdate({
        target: releaseVersions.id,
        set: {
          projectId: LOCAL_PROJECT_ID,
          releaseLineId: fixture.releaseLineId,
          kind: fixture.kind,
          productionVersionNumber: fixture.productionVersionNumber,
          targetProductionVersionNumber: fixture.targetProductionVersionNumber,
          candidateNumber: fixture.candidateNumber,
          promotedFromReleaseVersionId: fixture.promotedFromReleaseVersionId,
          promptId: fixture.promptId,
          promptName: fixture.promptName,
          promptVersionId: fixture.promptVersionId,
          promptVersionNumber: fixture.promptVersionNumber,
          promptSnapshot: fixture.promptSnapshot,
          promptVersionSnapshot: fixture.promptVersionSnapshot,
          modelId: fixture.modelId,
          modelSnapshot: fixture.modelSnapshot,
          updatedAt: new Date(fixture.updatedAt),
        },
      });
  }

  for (const fixture of DEV_RELEASE_EVENTS) {
    await db
      .insert(releaseLineEvents)
      .values({
        id: fixture.id,
        projectId: LOCAL_PROJECT_ID,
        releaseLineId: fixture.releaseLineId,
        laneType: fixture.laneType,
        operation: fixture.operation,
        status: fixture.status,
        terminalReason: fixture.terminalReason,
        sourceEventId: fixture.sourceEventId,
        supersedesEventId: fixture.supersedesEventId,
        rollbackTargetEventId: fixture.rollbackTargetEventId,
        releaseVersionId: fixture.releaseVersionId,
        promptId: fixture.promptId,
        promptName: fixture.promptName,
        promptVersionId: fixture.promptVersionId,
        promptVersionNumber: fixture.promptVersionNumber,
        promptSnapshot: fixture.promptSnapshot,
        promptVersionSnapshot: fixture.promptVersionSnapshot,
        modelId: fixture.modelId,
        modelSnapshot: fixture.modelSnapshot,
        inputConnectorId: fixture.inputConnectorId,
        inputConnectorSnapshot: fixture.inputConnectorSnapshot,
        outputConnectorIds: fixture.outputConnectorIds,
        outputConnectorSnapshots: fixture.outputConnectorSnapshots,
        trafficMode: fixture.trafficMode,
        trafficRatio: fixture.trafficRatio,
        runConfig: fixture.runConfig,
        variableMapping: fixture.variableMapping,
        outputMapping: fixture.outputMapping,
        filterRules: fixture.filterRules,
        recordMode: fixture.recordMode,
        externalIdField: fixture.externalIdField,
        retentionDays: fixture.retentionDays,
        sourceExperimentId: fixture.sourceExperimentId,
        submitReason: fixture.submitReason,
        metrics: fixture.metrics,
        totalReceived: fixture.totalReceived,
        totalProcessed: fixture.totalProcessed,
        totalFiltered: fixture.totalFiltered,
        totalCorrect: fixture.totalCorrect,
        totalErrors: fixture.totalErrors,
        controlState: fixture.controlState,
        controlStatePayload: fixture.controlStatePayload,
        startedAt: fixture.startedAt ? new Date(fixture.startedAt) : null,
        finishedAt: fixture.finishedAt ? new Date(fixture.finishedAt) : null,
        createdBy: LOCAL_ACTOR_ID,
        createdAt: new Date(fixture.createdAt),
        updatedAt: new Date(fixture.updatedAt),
      })
      .onConflictDoUpdate({
        target: releaseLineEvents.id,
        set: {
          projectId: LOCAL_PROJECT_ID,
          releaseLineId: fixture.releaseLineId,
          laneType: fixture.laneType,
          operation: fixture.operation,
          status: fixture.status,
          terminalReason: fixture.terminalReason,
          sourceEventId: fixture.sourceEventId,
          supersedesEventId: fixture.supersedesEventId,
          rollbackTargetEventId: fixture.rollbackTargetEventId,
          releaseVersionId: fixture.releaseVersionId,
          promptId: fixture.promptId,
          promptName: fixture.promptName,
          promptVersionId: fixture.promptVersionId,
          promptVersionNumber: fixture.promptVersionNumber,
          promptSnapshot: fixture.promptSnapshot,
          promptVersionSnapshot: fixture.promptVersionSnapshot,
          modelId: fixture.modelId,
          modelSnapshot: fixture.modelSnapshot,
          inputConnectorId: fixture.inputConnectorId,
          inputConnectorSnapshot: fixture.inputConnectorSnapshot,
          outputConnectorIds: fixture.outputConnectorIds,
          outputConnectorSnapshots: fixture.outputConnectorSnapshots,
          trafficMode: fixture.trafficMode,
          trafficRatio: fixture.trafficRatio,
          runConfig: fixture.runConfig,
          variableMapping: fixture.variableMapping,
          outputMapping: fixture.outputMapping,
          filterRules: fixture.filterRules,
          recordMode: fixture.recordMode,
          externalIdField: fixture.externalIdField,
          retentionDays: fixture.retentionDays,
          sourceExperimentId: fixture.sourceExperimentId,
          submitReason: fixture.submitReason,
          metrics: fixture.metrics,
          totalReceived: fixture.totalReceived,
          totalProcessed: fixture.totalProcessed,
          totalFiltered: fixture.totalFiltered,
          totalCorrect: fixture.totalCorrect,
          totalErrors: fixture.totalErrors,
          controlState: fixture.controlState,
          controlStatePayload: fixture.controlStatePayload,
          startedAt: fixture.startedAt ? new Date(fixture.startedAt) : null,
          finishedAt: fixture.finishedAt ? new Date(fixture.finishedAt) : null,
          updatedAt: new Date(fixture.updatedAt),
        },
      });
  }

  for (const fixture of DEV_RELEASE_RUN_RESULTS) {
    await db
      .insert(runResultIds)
      .values({
        id: fixture.id,
        createdAt: new Date(fixture.createdAt),
      })
      .onConflictDoNothing();

    await db.insert(runResults).values({
      id: fixture.id,
      projectId: LOCAL_PROJECT_ID,
      source: 'release',
      sourceId: fixture.sourceId,
      releaseVersionId: fixture.releaseVersionId,
      promptVersionId: fixture.promptVersionId,
      modelId: fixture.modelId,
      sampleId: fixture.sampleId,
      externalId: fixture.externalId,
      renderedPrompt: fixture.renderedPrompt,
      inputVariables: fixture.inputVariables,
      rawResponse: fixture.rawResponse,
      parsedOutput: fixture.parsedOutput,
      decisionOutput: fixture.decisionOutput,
      expectedOutput: fixture.expectedOutput,
      isCorrect: fixture.isCorrect,
      judgmentStatus: fixture.judgmentStatus,
      status: fixture.status,
      errorClass: fixture.errorClass,
      errorMessage: fixture.errorMessage,
      latencyMs: fixture.latencyMs,
      inputTokens: fixture.inputTokens,
      outputTokens: fixture.outputTokens,
      costEstimate: fixture.costEstimate,
      attempt: 1,
      dbosWorkflowId: null,
      bullmqJobId: null,
      webhookTokenId: null,
      createdAt: new Date(fixture.createdAt),
    });
  }

  for (const fixture of DEV_RELEASE_ANNOTATION_TASKS) {
    await db.insert(annotationTasks).values({
      id: fixture.id,
      scope: fixture.scope,
      canaryId: null,
      productionReleaseEventId: null,
      releaseLineEventId: fixture.releaseLineEventId,
      releaseVersionId: fixture.releaseVersionId,
      releaseVersionScope: fixture.releaseVersionScope,
      name: fixture.name,
      annotationSchema: fixture.annotationSchema,
      samplingConfig: fixture.samplingConfig,
      totalSampled: fixture.totalSampled,
      totalAnnotated: fixture.totalAnnotated,
      status: fixture.status,
      createdBy: LOCAL_ACTOR_ID,
      createdAt: new Date(fixture.createdAt),
      updatedAt: new Date(fixture.updatedAt),
    });
  }

  for (const fixture of DEV_RELEASE_ANNOTATIONS) {
    await db.insert(annotations).values({
      id: fixture.id,
      runResultId: fixture.runResultId,
      runResultCreatedAt: new Date(fixture.runResultCreatedAt),
      taskId: fixture.taskId,
      isCorrect: fixture.isCorrect,
      fields: fixture.fields,
      notes: fixture.notes,
      lockedBy: fixture.lockedBy,
      lockedAt: fixture.lockedAt ? new Date(fixture.lockedAt) : null,
      lockHeartbeatAt: fixture.lockHeartbeatAt ? new Date(fixture.lockHeartbeatAt) : null,
      submittedAt: fixture.submittedAt ? new Date(fixture.submittedAt) : null,
      submittedBy: fixture.submittedBy,
      createdAt: new Date(fixture.createdAt),
      updatedAt: new Date(fixture.updatedAt),
    });
  }
  console.warn(
    `✅  Release data ready: ${DEV_RELEASE_LINES.length} lines, ${DEV_RELEASE_VERSIONS.length} versions, ${DEV_RELEASE_EVENTS.length} events, ${DEV_RELEASE_RUN_RESULTS.length} run results`,
  );
  console.warn('✅  Local dev data snapshot written successfully');

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
