import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfiguredInstance, DBOS } from '@dbos-inc/dbos-sdk';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { createLogger } from '@proofhound/logger';
import type { LlmJobPayload } from '@proofhound/orchestration-shared';
import type {
  ExperimentMetricsDto,
  PromptLanguageDto,
  PromptOutputSchemaDto,
  PromptVariableDto,
} from '@proofhound/shared';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import { BullmqService } from '../../infrastructure/orchestration/bullmq.service';
import { RunResultService } from '../run-result/run-result.service';
import { aggregateExperimentMetrics } from './experiment.aggregator';
import { renderPromptForSample } from './experiment.renderer';

const { experiments, datasetSamples, promptVersions, models, datasets } = schema;

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 500;
const POLL_SLEEP_SCHEDULE_SEC = [2, 2, 3, 5, 8, 10];
// Per-batch poll budget scales with batch size (~36s/sample, matching the historical 30min/50-sample budget),
// floored at 30min and capped at 6h. Larger batches need a proportionally larger wall-clock window so the
// poll loop does not give up while jobs are still draining the queue.
const POLL_PER_SAMPLE_BUDGET_SEC = 36;
const MIN_POLL_TIMEOUT_SEC = 30 * 60;
const MAX_POLL_TIMEOUT_SEC = 6 * 60 * 60;

function batchPollTimeoutSec(batchSize: number): number {
  return Math.min(MAX_POLL_TIMEOUT_SEC, Math.max(MIN_POLL_TIMEOUT_SEC, batchSize * POLL_PER_SAMPLE_BUDGET_SEC));
}
// runResultId namespace UUID (chosen randomly and pinned, to stay stable across restarts)
const RUN_RESULT_NS = '6f1c2c0a-2c4e-4f5a-9d8a-3b1e2a000001';

export interface ExperimentPlan {
  experimentId: string;
  projectId: string;
  promptId: string;
  promptVersionId: string;
  datasetId: string;
  modelId: string;
  totalSamples: number;
  batchSize: number;
  isFrozen: boolean;
  promptVersionExists: boolean;
}

interface RenderedPromptForPayload {
  renderedPrompt: LlmJobPayload['renderedPrompt'];
  inputVariables: Record<string, unknown>;
  expectedOutput: unknown;
}

// DBOS SDK 4.x requires the host class of instance-method workflow / step to extend ConfiguredInstance,
// otherwise restore cannot find the instance and the runtime throws DBOSInvalidWorkflowTransitionError.
@Injectable()
export class ExperimentWorkflowRegistrar extends ConfiguredInstance {
  private readonly logger = createLogger('experiment.workflow', { service: 'server' });

  // Registration must happen before DBOS.launch(). NestJS instantiates all providers before invoking onModuleInit hooks;
  // DbosService.onModuleInit also runs before ExperimentModule.onModuleInit, so placing
  // registerStep / registerWorkflow in the constructor is the simplest way to guarantee register-before-launch.
  readonly runWorkflow: (experimentId: string) => Promise<void>;
  private readonly loadPlanStep: (experimentId: string) => Promise<ExperimentPlan>;
  private readonly markStartedStep: (experimentId: string) => Promise<void>;
  private readonly readControlStateStep: (experimentId: string) => Promise<string | null>;
  private readonly clearResumeStep: (experimentId: string) => Promise<void>;
  private readonly loadSampleIdBatchStep: (
    datasetId: string,
    cursorId: string | null,
    batchSize: number,
  ) => Promise<string[]>;
  private readonly enqueueBatchStep: (experimentId: string, sampleIds: string[]) => Promise<string[]>;
  private readonly pollUntilBatchDoneStep: (
    experimentId: string,
    runResultIds: string[],
  ) => Promise<{ terminalCount: number; failedCount: number; control: 'stop' | 'cancel' | null }>;
  private readonly aggregateMetricsStep: (experimentId: string) => Promise<void>;
  private readonly finalizeStep: (
    experimentId: string,
    kind: 'success' | 'failed' | 'stopped' | 'cancelled',
    failureReason?: string,
  ) => Promise<void>;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly db: DbClient,
    private readonly bullmq: BullmqService,
    private readonly runResults: RunResultService,
  ) {
    super('experiment-workflow');
    this.loadPlanStep = DBOS.registerStep(this.loadPlanImpl.bind(this), { name: 'experiment.loadPlan' });
    this.markStartedStep = DBOS.registerStep(this.markStartedImpl.bind(this), { name: 'experiment.markStarted' });
    this.readControlStateStep = DBOS.registerStep(this.readControlStateImpl.bind(this), {
      name: 'experiment.readControlState',
    });
    this.clearResumeStep = DBOS.registerStep(this.clearResumeImpl.bind(this), { name: 'experiment.clearResume' });
    this.loadSampleIdBatchStep = DBOS.registerStep(this.loadSampleIdBatchImpl.bind(this), {
      name: 'experiment.loadSampleIdBatch',
    });
    this.enqueueBatchStep = DBOS.registerStep(this.enqueueBatchImpl.bind(this), { name: 'experiment.enqueueBatch' });
    this.pollUntilBatchDoneStep = DBOS.registerStep(this.pollUntilBatchDoneImpl.bind(this), {
      name: 'experiment.pollUntilBatchDone',
    });
    this.aggregateMetricsStep = DBOS.registerStep(this.aggregateMetricsImpl.bind(this), {
      name: 'experiment.aggregateMetrics',
    });
    this.finalizeStep = DBOS.registerStep(this.finalizeImpl.bind(this), { name: 'experiment.finalize' });

    this.runWorkflow = DBOS.registerWorkflow(this.runImpl.bind(this), { name: 'ExperimentWorkflow' });

    this.logger.info({}, 'experiment_workflow_registered');
  }

  private async runImpl(experimentId: string): Promise<void> {
    this.logger.debug({ experimentId }, 'workflow_run_start');

    try {
      const plan = await this.loadPlanStep(experimentId);
      if (!plan.promptVersionExists) {
        await this.finalizeStep(experimentId, 'failed', 'prompt_version_not_found');
        return;
      }
      if (!plan.isFrozen) {
        await this.finalizeStep(experimentId, 'failed', 'prompt_version_not_frozen');
        return;
      }
      if (plan.totalSamples === 0) {
        await this.finalizeStep(experimentId, 'failed', 'dataset_empty');
        return;
      }

      await this.markStartedStep(experimentId);

      let totalFailed = 0;
      let totalTerminal = 0;
      let processed = 0;
      // Keyset cursor: last sample id of the previous batch (see loadSampleIdBatchImpl).
      let cursorId: string | null = null;

      while (processed < plan.totalSamples) {
        this.logger.debug(
          { experimentId, processed, batchSize: plan.batchSize, totalSamples: plan.totalSamples },
          'workflow_batch_start',
        );
        const control = await this.readControlStateStep(experimentId);
        if (control === 'cancel') {
          await this.finalizeStep(experimentId, 'cancelled');
          return;
        }
        if (control === 'stop') {
          await this.finalizeStep(experimentId, 'stopped');
          return;
        }
        if (control === 'resume') {
          await this.clearResumeStep(experimentId);
        }

        const sampleIds = await this.loadSampleIdBatchStep(plan.datasetId, cursorId, plan.batchSize);
        if (sampleIds.length === 0) break;

        const runResultIds = await this.enqueueBatchStep(experimentId, sampleIds);
        const counts = await this.pollUntilBatchDoneStep(experimentId, runResultIds);
        totalTerminal += counts.terminalCount;
        totalFailed += counts.failedCount;
        await this.aggregateMetricsStep(experimentId);
        processed += sampleIds.length;
        cursorId = sampleIds[sampleIds.length - 1] ?? cursorId;
        this.logger.debug(
          {
            experimentId,
            processed,
            batchTerminal: counts.terminalCount,
            batchFailed: counts.failedCount,
            control: counts.control,
          },
          'workflow_batch_done',
        );
        // Control signals observed inside poll: already-enqueued LLM jobs are not cancelled (the worker has no abort channel),
        // but the workflow terminates immediately at the batch boundary and stops dispatching new batches
        if (counts.control === 'cancel') {
          await this.finalizeStep(experimentId, 'cancelled');
          return;
        }
        if (counts.control === 'stop') {
          await this.finalizeStep(experimentId, 'stopped');
          return;
        }
      }

      this.logger.debug({ experimentId, totalTerminal, totalFailed }, 'workflow_loop_finished');

      // All samples failed → the experiment as a whole is failed; partial failures still count as success (failed_samples is already reflected in metrics)
      if (totalTerminal > 0 && totalFailed === totalTerminal) {
        await this.finalizeStep(experimentId, 'failed', 'all_samples_failed');
        return;
      }

      await this.finalizeStep(experimentId, 'success');
    } catch (error) {
      this.logger.error({ experimentId, error: (error as Error).message }, 'experiment_workflow_failed');
      await this.finalizeStep(experimentId, 'failed', (error as Error).message);
    }
  }

  private async loadPlanImpl(experimentId: string): Promise<ExperimentPlan> {
    const rows = await this.db
      .select({
        id: experiments.id,
        projectId: experiments.projectId,
        promptVersionId: experiments.promptVersionId,
        datasetId: experiments.datasetId,
        modelId: experiments.modelId,
        runConfig: experiments.runConfig,
        sampleCount: datasets.sampleCount,
        isFrozen: promptVersions.isFrozen,
        promptId: promptVersions.promptId,
      })
      .from(experiments)
      .innerJoin(promptVersions, eq(promptVersions.id, experiments.promptVersionId))
      .innerJoin(datasets, eq(datasets.id, experiments.datasetId))
      .where(and(eq(experiments.id, experimentId), isNull(experiments.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new Error(`experiment_not_found: ${experimentId}`);
    }

    const config = (row.runConfig as Record<string, unknown> | null) ?? {};
    const batchSize =
      typeof config['batchSize'] === 'number' && (config['batchSize'] as number) > 0
        ? Math.min(config['batchSize'] as number, MAX_BATCH_SIZE)
        : DEFAULT_BATCH_SIZE;

    const plan: ExperimentPlan = {
      experimentId: row.id,
      projectId: row.projectId,
      promptId: row.promptId,
      promptVersionId: row.promptVersionId,
      datasetId: row.datasetId,
      modelId: row.modelId,
      totalSamples: row.sampleCount ?? 0,
      batchSize,
      isFrozen: row.isFrozen,
      promptVersionExists: true,
    };
    this.logger.debug(
      {
        experimentId,
        totalSamples: plan.totalSamples,
        batchSize: plan.batchSize,
        isFrozen: plan.isFrozen,
      },
      'step_load_plan_done',
    );
    return plan;
  }

  private async markStartedImpl(experimentId: string): Promise<void> {
    await this.db
      .update(experiments)
      .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(experiments.id, experimentId), isNull(experiments.deletedAt)));
    this.logger.debug({ experimentId }, 'step_mark_started_done');
  }

  private async readControlStateImpl(experimentId: string): Promise<string | null> {
    const rows = await this.db
      .select({ controlState: experiments.controlState })
      .from(experiments)
      .where(eq(experiments.id, experimentId))
      .limit(1);
    const controlState = rows[0]?.controlState ?? null;
    this.logger.debug({ experimentId, controlState }, 'step_read_control_state_done');
    return controlState;
  }

  private async clearResumeImpl(experimentId: string): Promise<void> {
    await this.db
      .update(experiments)
      .set({ controlState: null, status: 'running', updatedAt: new Date() })
      .where(and(eq(experiments.id, experimentId), eq(experiments.controlState, 'resume')));
    this.logger.debug({ experimentId }, 'step_clear_resume_done');
  }

  private async loadSampleIdBatchImpl(datasetId: string, cursorId: string | null, batchSize: number): Promise<string[]> {
    // Keyset pagination by id: a dataset's samples share created_at (NOW() at insert/promote time), so id alone is a
    // complete, stable total order. Avoids OFFSET's O(n^2) rescans on large datasets.
    const condition =
      cursorId === null
        ? eq(datasetSamples.datasetId, datasetId)
        : and(eq(datasetSamples.datasetId, datasetId), gt(datasetSamples.id, cursorId));
    const rows = await this.db
      .select({ id: datasetSamples.id })
      .from(datasetSamples)
      .where(condition)
      .orderBy(asc(datasetSamples.id))
      .limit(batchSize);
    this.logger.debug({ datasetId, cursorId, batchSize, sampleCount: rows.length }, 'step_load_sample_batch_done');
    return rows.map((r) => r.id);
  }

  private async enqueueBatchImpl(experimentId: string, sampleIds: string[]): Promise<string[]> {
    const renderContext = await this.loadRenderContext(experimentId);
    const samples = await this.loadSampleDataByIds(sampleIds);
    const expectedField = readExpectedField(renderContext.judgmentRules);
    // Inside the step we call DBOS.workflowID to capture the current workflow id, and pass it along in the payload to the worker,
    // so that LLM call logs and ph_runs.run_results.dbos_workflow_id can be threaded by workflow (SPEC 05 §5.6)
    const dbosWorkflowId = DBOS.workflowID;

    const runResultIds: string[] = [];
    for (const sample of samples) {
      const runResultId = uuidV5FromSample(experimentId, sample.id);
      runResultIds.push(runResultId);
      const sampleData = (sample.data ?? {}) as Record<string, unknown>;
      const { renderedPrompt, inputVariables } = renderPromptForSample(
        {
          body: renderContext.body,
          variables: renderContext.variables,
          outputSchema: renderContext.outputSchema,
          promptLanguage: renderContext.promptLanguage,
        },
        { data: sampleData },
      );
      const expectedOutput = sampleData[expectedField];
      const payload: LlmJobPayload = {
        projectId: renderContext.projectId,
        source: 'experiment',
        sourceId: experimentId,
        promptVersionId: renderContext.promptVersionId,
        promptId: renderContext.promptId,
        modelId: renderContext.modelId,
        runResultId,
        sampleId: sample.id,
        dbosWorkflowId,
        renderedPrompt,
        inputVariables,
        inference: pickInference(renderContext.runConfig),
        limits: pickLimits(renderContext.runConfig),
        retry: pickRetry(renderContext.runConfig),
        judgment: {
          outputSchema: renderContext.outputSchema,
          judgmentRules: renderContext.judgmentRules,
          expectedOutput,
        },
      };
      await this.bullmq.enqueueLlmJob(payload, runResultId);
    }

    this.logger.debug({ experimentId, enqueuedCount: runResultIds.length }, 'step_enqueue_batch_done');
    return runResultIds;
  }

  private async pollUntilBatchDoneImpl(
    experimentId: string,
    runResultIds: string[],
  ): Promise<{ terminalCount: number; failedCount: number; control: 'stop' | 'cancel' | null }> {
    if (runResultIds.length === 0) return { terminalCount: 0, failedCount: 0, control: null };

    const timeoutSec = batchPollTimeoutSec(runResultIds.length);
    let pollIndex = 0;
    const start = Date.now();
    while (Date.now() - start < timeoutSec * 1000) {
      const counts = await this.runResults.countBatchTerminal(experimentId, runResultIds);
      this.logger.debug({ experimentId, pollIndex, expected: runResultIds.length, ...counts }, 'step_poll_batch_tick');
      if (counts.terminalCount >= runResultIds.length) return { ...counts, control: null };

      // Re-read control_state every poll round, so that under large-batch + slow-model scenarios, a user who clicks stop does not have to wait for the whole batch to finish
      const controlState = await this.readControlStateImpl(experimentId);
      if (controlState === 'stop' || controlState === 'cancel') {
        this.logger.debug({ experimentId, controlState }, 'step_poll_batch_control_interrupt');
        return { ...counts, control: controlState };
      }

      const sleepSec = POLL_SLEEP_SCHEDULE_SEC[Math.min(pollIndex, POLL_SLEEP_SCHEDULE_SEC.length - 1)] ?? 5;
      pollIndex += 1;
      await DBOS.sleepSeconds(sleepSec);
    }
    this.logger.debug(
      { experimentId, pollIndex, batchSize: runResultIds.length, timeoutSec },
      'step_poll_batch_timeout',
    );
    const finalCounts = await this.runResults.countBatchTerminal(experimentId, runResultIds);
    return { ...finalCounts, control: null };
  }

  private async aggregateMetricsImpl(experimentId: string): Promise<void> {
    const [rows, latency] = await Promise.all([
      this.runResults.aggregateExperiment(experimentId),
      this.runResults.aggregateExperimentLatency(experimentId),
    ]);
    const { metrics, totalCount, failedCount } = aggregateExperimentMetrics(rows, latency);
    await this.db
      .update(experiments)
      .set({
        metrics: metrics as ExperimentMetricsDto,
        processedSamples: totalCount,
        failedSamples: failedCount,
        updatedAt: new Date(),
      })
      .where(and(eq(experiments.id, experimentId), isNull(experiments.deletedAt)));
    this.logger.debug(
      { experimentId, totalCount, failedCount, accuracy: metrics?.accuracy ?? null },
      'step_aggregate_metrics_done',
    );
  }

  private async finalizeImpl(
    experimentId: string,
    kind: 'success' | 'failed' | 'stopped' | 'cancelled',
    failureReason?: string,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(experiments)
      .set({
        status: kind,
        controlState: null,
        finishedAt: now,
        updatedAt: now,
        failureReason: failureReason ?? null,
        failureKind: kind === 'failed' ? 'internal' : null,
      })
      .where(and(eq(experiments.id, experimentId), isNull(experiments.deletedAt)));

    this.logger.info({ experimentId, kind, failureReason }, 'experiment_workflow_finalized');
  }

  private async loadRenderContext(experimentId: string) {
    const rows = await this.db
      .select({
        projectId: experiments.projectId,
        promptVersionId: experiments.promptVersionId,
        modelId: experiments.modelId,
        runConfig: experiments.runConfig,
        promptId: promptVersions.promptId,
        body: promptVersions.body,
        variables: promptVersions.variables,
        outputSchema: promptVersions.outputSchema,
        judgmentRules: promptVersions.judgmentRules,
        promptLanguage: promptVersions.promptLanguage,
        modelProviderId: models.providerModelId,
      })
      .from(experiments)
      .innerJoin(promptVersions, eq(promptVersions.id, experiments.promptVersionId))
      .innerJoin(models, eq(models.id, experiments.modelId))
      .where(eq(experiments.id, experimentId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`experiment_render_context_missing: ${experimentId}`);
    return {
      projectId: row.projectId,
      promptVersionId: row.promptVersionId,
      promptId: row.promptId,
      modelId: row.modelId,
      runConfig: (row.runConfig as Record<string, unknown> | null) ?? {},
      body: row.body ?? '',
      variables: (row.variables as PromptVariableDto[]) ?? [],
      outputSchema: row.outputSchema as PromptOutputSchemaDto,
      judgmentRules: row.judgmentRules ?? null,
      promptLanguage: row.promptLanguage as PromptLanguageDto,
    };
  }

  private async loadSampleDataByIds(
    sampleIds: string[],
  ): Promise<Array<{ id: string; data: Record<string, unknown> | null }>> {
    if (sampleIds.length === 0) return [];
    const rows = await this.db
      .select({ id: datasetSamples.id, data: datasetSamples.data })
      .from(datasetSamples)
      .where(inArrayUuids(datasetSamples.id, sampleIds));
    return rows.map((r) => ({ id: r.id, data: (r.data as Record<string, unknown> | null) ?? null }));
  }
}

export function readExpectedField(rules: unknown): string {
  if (rules && typeof rules === 'object') {
    const record = rules as Record<string, unknown>;
    const f = record['expected_field'] ?? record['expectedField'];
    if (typeof f === 'string' && f.length > 0) return f;
    const rawRules = record['rules'];
    if (Array.isArray(rawRules)) {
      for (const rule of rawRules) {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
        const nested =
          (rule as Record<string, unknown>)['expected_field'] ??
          (rule as Record<string, unknown>)['expectedField'] ??
          (rule as Record<string, unknown>)['value'];
        if (typeof nested === 'string' && nested.length > 0) return nested;
      }
    }
  }
  return 'expected_output';
}

function pickInference(runConfig: Record<string, unknown>): LlmJobPayload['inference'] {
  const out: NonNullable<LlmJobPayload['inference']> = {};
  if (typeof runConfig['temperature'] === 'number') out.temperature = runConfig['temperature'] as number;
  if (typeof runConfig['maxTokens'] === 'number') out.maxTokens = runConfig['maxTokens'] as number;
  if (typeof runConfig['topP'] === 'number') out.topP = runConfig['topP'] as number;
  if (typeof runConfig['apiVersion'] === 'string') out.apiVersion = runConfig['apiVersion'] as string;
  return Object.keys(out).length > 0 ? out : undefined;
}

// Experiment-level "self-throttling" cap. The worker takes min(this, model-level quota) before invokeLLM;
// the model-level cap is always the ceiling (SPEC 21 §quota / SPEC 24 §4).
export function pickLimits(runConfig: Record<string, unknown>): LlmJobPayload['limits'] {
  const out: NonNullable<LlmJobPayload['limits']> = {};
  if (typeof runConfig['rpmLimit'] === 'number' && runConfig['rpmLimit'] > 0) {
    out.rpmLimit = runConfig['rpmLimit'] as number;
  }
  if (typeof runConfig['tpmLimit'] === 'number' && runConfig['tpmLimit'] > 0) {
    out.tpmLimit = runConfig['tpmLimit'] as number;
  }
  if (typeof runConfig['concurrency'] === 'number' && runConfig['concurrency'] > 0) {
    out.concurrency = runConfig['concurrency'] as number;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// DTO uses retries (plural) while payload uses maxRetries (singular) — the picker handles the rename.
export function pickRetry(runConfig: Record<string, unknown>): LlmJobPayload['retry'] {
  if (typeof runConfig['retries'] === 'number' && runConfig['retries'] >= 0) {
    return { maxRetries: runConfig['retries'] as number };
  }
  return undefined;
}

function uuidV5FromSample(experimentId: string, sampleId: string): string {
  const hash = createHash('sha1').update(`${RUN_RESULT_NS}:${experimentId}:${sampleId}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// drizzle-orm does not expose inArray for raw uuid arrays; manually compose a safe IN clause
function inArrayUuids(column: PgColumn, ids: string[]) {
  const params = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return sql`${column} IN (${params})`;
}

// For external e2e / mcp callers: expose a stable runResultId computation
export function computeRunResultId(experimentId: string, sampleId: string): string {
  return uuidV5FromSample(experimentId, sampleId);
}
