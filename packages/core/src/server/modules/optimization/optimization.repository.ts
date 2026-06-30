import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

const {
  optimizationRoundSteps,
  optimizations,
  datasets,
  experiments,
  models,
  projects,
  prompts,
  promptVersions,
  runResults,
} = schema;

const analysisModels = alias(models, 'analysis_models');
const bestVersions = alias(promptVersions, 'best_versions');
const sourceExperimentPromptVersions = alias(promptVersions, 'source_experiment_prompt_versions');

export interface OptimizationProjectAccessRow {
  id: string;
}

export interface OptimizationRow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  optimizationHint: string | null;
  strategy: string;
  strategyConfig: unknown;
  startingMode: string;
  sourceExperimentId: string | null;
  sourceExperimentName: string | null;
  sourceExperimentMetrics: unknown;
  sourceExperimentPromptVersionId: string | null;
  sourceExperimentPromptVersionNumber: number | null;
  sourceExperimentStatus: string | null;
  sourceExperimentFailureReason: string | null;
  sourceExperimentStartedAt: Date | null;
  sourceExperimentFinishedAt: Date | null;
  sourceExperimentTotalSamples: number | null;
  sourceExperimentProcessedSamples: number | null;
  sourceExperimentFailedSamples: number | null;
  promptId: string | null;
  promptName: string | null;
  baseVersionId: string | null;
  baseVersionNumber: number | null;
  datasetId: string;
  datasetName: string;
  datasetSamples: number;
  experimentModelId: string;
  experimentModelName: string;
  analysisModelId: string;
  analysisModelName: string;
  promptLanguage: string;
  status: string;
  objectiveStatus: string;
  controlState: string | null;
  dbosWorkflowId: string | null;
  goals: unknown;
  fieldWhitelist: unknown;
  runConfig: unknown;
  maxRounds: number;
  stopAfterNoImprovementRounds: number;
  currentRound: number;
  bestVersionId: string | null;
  bestVersionNumber: number | null;
  bestMetrics: unknown;
  summary: unknown;
  analysisFailureReason: string | null;
  createdBy: string;
  createdByDisplayName: string | null;
  createdByUsername: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface OptimizationInsertValues {
  id?: string;
  projectId: string;
  name: string;
  description: string | null;
  optimizationHint: string | null;
  strategy: string;
  strategyConfig: unknown;
  startingMode: string;
  sourceExperimentId: string | null;
  promptId: string | null;
  baseVersionId: string | null;
  datasetId: string;
  experimentModelId: string;
  analysisModelId: string;
  promptLanguage: string;
  status: string;
  objectiveStatus?: string;
  goals: unknown;
  fieldWhitelist: unknown;
  runConfig: unknown;
  maxRounds: number;
  stopAfterNoImprovementRounds: number;
  createdBy: string;
}

export interface OptimizationUpdateValues {
  status?: string;
  objectiveStatus?: string;
  controlState?: string | null;
  sourceExperimentId?: string | null;
  currentRound?: number;
  bestVersionId?: string | null;
  bestMetrics?: unknown | null;
  summary?: unknown | null;
  analysisFailureReason?: string | null;
  dbosWorkflowId?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export interface OptimizationWorkflowContext {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  optimizationHint: string | null;
  strategy: string;
  strategyConfig: unknown;
  startingMode: string;
  sourceExperimentId: string | null;
  promptId: string | null;
  baseVersionId: string | null;
  baseVersionBody: string | null;
  baseVersionVariables: unknown;
  baseVersionOutputSchema: unknown;
  baseVersionJudgmentRules: unknown;
  baseVersionPromptLanguage: string | null;
  baseVersionNumber: number | null;
  datasetId: string;
  datasetSampleCount: number;
  experimentModelId: string;
  analysisModelId: string;
  promptLanguage: string;
  goals: unknown;
  fieldWhitelist: unknown;
  runConfig: unknown;
  maxRounds: number;
  stopAfterNoImprovementRounds: number;
  currentRound: number;
  bestVersionId: string | null;
  bestMetrics: unknown;
  status: string;
  controlState: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdBy: string;
}

export interface OptimizationRoundExperimentRow {
  experimentId: string;
  experimentName: string;
  roundIndex: number;
  isBaseline?: boolean;
  promptVersionId: string;
  promptVersionNumber: number | null;
  parentVersionId: string | null;
  status: string;
  metrics: unknown;
  failureReason: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  totalSamples: number;
  processedSamples: number;
  failedSamples: number;
  updatedAt?: Date;
}

export interface OptimizationRoundLlmRow {
  runResultId: string;
  roundIndex: number;
  source: string;
  promptVersionId: string;
  parsedOutput: unknown;
  rawResponse: string | null;
  errorMessage: string | null;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costEstimate: string | null;
  createdAt: Date;
}

export interface OptimizationActiveRunningRow {
  optimizationId: string;
  projectId: string;
  dbosWorkflowId: string;
}

export type OptimizationRoundStepKind = 'error_analysis' | 'generate_prompt' | 'experiment';
export type OptimizationRoundStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface OptimizationRoundStepRow {
  optimizationId: string;
  roundIndex: number;
  step: OptimizationRoundStepKind;
  status: OptimizationRoundStepStatus;
  errorClass: string | null;
  errorMessage: string | null;
  runResultId: string | null;
  experimentId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  attempt: number;
  dbosWorkflowId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OptimizationAnalysisExperimentRow {
  id: string;
  roundIndex: number | null;
  metrics: unknown;
  promptVersionId: string;
}

export interface OptimizationRunResultRow {
  id: string;
  sampleId: string | null;
  parsedOutput: unknown;
  decisionOutput: string | null;
  isCorrect: boolean | null;
  errorMessage: string | null;
  rawResponse: string | null;
}

// Cross-round history aggregation row (SPEC 25 §11.3) — one row = one completed round of optimization;
// generateParsedOutput comes from run_results (source='optimization_generate', status='success');
// for legacy data / parse failures it is null, callers fall back to empty fields without blocking the main path
export interface OptimizationRoundHistoryRow {
  roundIndex: number;
  metrics: unknown;
  promptVersionId: string;
  parentVersionId: string | null;
  generateParsedOutput: unknown;
  isBest: boolean;
}

export interface RoundStepUpsertInput {
  optimizationId: string;
  roundIndex: number;
  step: OptimizationRoundStepKind;
  status: OptimizationRoundStepStatus;
  errorClass?: string | null;
  errorMessage?: string | null;
  runResultId?: string | null;
  experimentId?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  attempt?: number;
  dbosWorkflowId?: string | null;
}

@Injectable()
export class OptimizationRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  private readonly selectFields = {
    id: optimizations.id,
    projectId: optimizations.projectId,
    name: optimizations.name,
    description: optimizations.description,
    optimizationHint: optimizations.optimizationHint,
    strategy: optimizations.strategy,
    strategyConfig: optimizations.strategyConfig,
    startingMode: optimizations.startingMode,
    sourceExperimentId: optimizations.sourceExperimentId,
    sourceExperimentName: experiments.name,
    sourceExperimentMetrics: experiments.metrics,
    sourceExperimentPromptVersionId: experiments.promptVersionId,
    sourceExperimentPromptVersionNumber: sourceExperimentPromptVersions.versionNumber,
    sourceExperimentStatus: experiments.status,
    sourceExperimentFailureReason: experiments.failureReason,
    sourceExperimentStartedAt: experiments.startedAt,
    sourceExperimentFinishedAt: experiments.finishedAt,
    sourceExperimentTotalSamples: experiments.totalSamples,
    sourceExperimentProcessedSamples: experiments.processedSamples,
    sourceExperimentFailedSamples: experiments.failedSamples,
    promptId: optimizations.promptId,
    promptName: prompts.name,
    baseVersionId: optimizations.baseVersionId,
    baseVersionNumber: promptVersions.versionNumber,
    datasetId: optimizations.datasetId,
    datasetName: datasets.name,
    datasetSamples: datasets.sampleCount,
    experimentModelId: optimizations.experimentModelId,
    experimentModelName: models.name,
    analysisModelId: optimizations.analysisModelId,
    analysisModelName: analysisModels.name,
    promptLanguage: optimizations.promptLanguage,
    status: optimizations.status,
    objectiveStatus: optimizations.objectiveStatus,
    controlState: optimizations.controlState,
    dbosWorkflowId: optimizations.dbosWorkflowId,
    goals: optimizations.goals,
    fieldWhitelist: optimizations.fieldWhitelist,
    runConfig: optimizations.runConfig,
    maxRounds: optimizations.maxRounds,
    stopAfterNoImprovementRounds: optimizations.stopAfterNoImprovementRounds,
    currentRound: optimizations.currentRound,
    bestVersionId: optimizations.bestVersionId,
    bestVersionNumber: bestVersions.versionNumber,
    bestMetrics: optimizations.bestMetrics,
    summary: optimizations.summary,
    analysisFailureReason: optimizations.analysisFailureReason,
    createdBy: optimizations.createdBy,
    createdByDisplayName: sql<string | null>`NULL`,
    createdByUsername: sql<string | null>`NULL`,
    startedAt: optimizations.startedAt,
    finishedAt: optimizations.finishedAt,
    createdAt: optimizations.createdAt,
    updatedAt: optimizations.updatedAt,
    deletedAt: optimizations.deletedAt,
  };

  async findProjectAccess(
    _actorUserId: string,
    projectId: string,
    _isSuperAdmin: boolean,
  ): Promise<OptimizationProjectAccessRow | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listOptimizations(projectId: string): Promise<OptimizationRow[]> {
    return this.runSelect(and(eq(optimizations.projectId, projectId), isNull(optimizations.deletedAt))).orderBy(
      desc(optimizations.updatedAt),
      desc(optimizations.createdAt),
    );
  }

  async findOptimizationById(projectId: string, optimizationId: string): Promise<OptimizationRow | null> {
    const rows = await this.runSelect(
      and(
        eq(optimizations.projectId, projectId),
        eq(optimizations.id, optimizationId),
        isNull(optimizations.deletedAt),
      ),
    ).limit(1);

    return rows[0] ?? null;
  }

  async findOptimizationByProjectAndName(projectId: string, name: string): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: optimizations.id })
      .from(optimizations)
      .where(and(eq(optimizations.projectId, projectId), eq(optimizations.name, name), isNull(optimizations.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  async insertOptimization(values: OptimizationInsertValues): Promise<string> {
    const [row] = await this.db
      .insert(optimizations)
      .values({
        projectId: values.projectId,
        name: values.name,
        description: values.description,
        optimizationHint: values.optimizationHint,
        strategy: values.strategy,
        strategyConfig: values.strategyConfig as Record<string, unknown>,
        startingMode: values.startingMode,
        sourceExperimentId: values.sourceExperimentId,
        promptId: values.promptId,
        baseVersionId: values.baseVersionId,
        datasetId: values.datasetId,
        experimentModelId: values.experimentModelId,
        analysisModelId: values.analysisModelId,
        promptLanguage: values.promptLanguage,
        status: values.status,
        objectiveStatus: values.objectiveStatus ?? 'pending',
        goals: values.goals as unknown,
        fieldWhitelist: values.fieldWhitelist as unknown,
        runConfig: values.runConfig as Record<string, unknown>,
        maxRounds: values.maxRounds,
        stopAfterNoImprovementRounds: values.stopAfterNoImprovementRounds,
        createdBy: values.createdBy,
      })
      .returning({ id: optimizations.id });
    if (!row) throw new Error('optimization_insert_failed');
    return row.id;
  }

  async updateOptimization(projectId: string, optimizationId: string, values: OptimizationUpdateValues): Promise<void> {
    await this.db
      .update(optimizations)
      .set({ ...values, updatedAt: values.updatedAt ?? new Date() })
      .where(
        and(
          eq(optimizations.id, optimizationId),
          eq(optimizations.projectId, projectId),
          isNull(optimizations.deletedAt),
        ),
      );
  }

  async hardDeleteOptimization(projectId: string, optimizationId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        WITH target_experiments AS (
          SELECT id
          FROM ph_runs.experiments
          WHERE project_id = ${projectId}::uuid
            AND optimization_id = ${optimizationId}::uuid
            AND deleted_at IS NULL
        ),
        target_run_results AS (
          SELECT rr.id, rr.created_at
          FROM ph_runs.run_results rr
          WHERE (
            rr.source = 'experiment'
            AND rr.source_id IN (SELECT id FROM target_experiments)
          )
          OR (
            rr.source IN ('optimization_analysis', 'optimization_generate')
            AND rr.source_id = ${optimizationId}::uuid
          )
        )
        DELETE FROM ph_runs.annotations annotation
        USING target_run_results rr
        WHERE annotation.run_result_id = rr.id
          AND annotation.run_result_created_at = rr.created_at
      `);

      await tx.execute(sql`
        WITH target_experiments AS (
          SELECT id
          FROM ph_runs.experiments
          WHERE project_id = ${projectId}::uuid
            AND optimization_id = ${optimizationId}::uuid
            AND deleted_at IS NULL
        ),
        target_run_results AS (
          SELECT rr.id, rr.created_at
          FROM ph_runs.run_results rr
          WHERE (
            rr.source = 'experiment'
            AND rr.source_id IN (SELECT id FROM target_experiments)
          )
          OR (
            rr.source IN ('optimization_analysis', 'optimization_generate')
            AND rr.source_id = ${optimizationId}::uuid
          )
        )
        DELETE FROM ph_runs.run_results rr
        USING target_run_results target
        WHERE rr.id = target.id
          AND rr.created_at = target.created_at
      `);

      await tx.execute(sql`
        WITH target_experiments AS (
          SELECT id
          FROM ph_runs.experiments
          WHERE project_id = ${projectId}::uuid
            AND optimization_id = ${optimizationId}::uuid
            AND deleted_at IS NULL
        )
        UPDATE ph_releases.production_release_events event
        SET source_experiment_id = NULL,
            updated_at = now()
        WHERE event.project_id = ${projectId}::uuid
          AND event.source_experiment_id IN (SELECT id FROM target_experiments)
      `);

      await tx.execute(sql`
        WITH target_experiments AS (
          SELECT id
          FROM ph_runs.experiments
          WHERE project_id = ${projectId}::uuid
            AND optimization_id = ${optimizationId}::uuid
            AND deleted_at IS NULL
        )
        UPDATE ph_releases.release_line_events event
        SET source_experiment_id = NULL,
            updated_at = now()
        WHERE event.project_id = ${projectId}::uuid
          AND event.source_experiment_id IN (SELECT id FROM target_experiments)
      `);

      await tx.delete(optimizationRoundSteps).where(eq(optimizationRoundSteps.optimizationId, optimizationId));

      await tx
        .delete(experiments)
        .where(and(eq(experiments.projectId, projectId), eq(experiments.optimizationId, optimizationId)));

      await tx
        .delete(optimizations)
        .where(and(eq(optimizations.projectId, projectId), eq(optimizations.id, optimizationId)));
    });
  }

  /**
   * from_dataset_only start: before creating the optimization, the service reads the dataset's name to auto-generate the prompt name.
   * Returns only (id, name); other fields are not needed. Returns null when not found (deleted / cross-project).
   * See SPEC 25 §2.1.
   */
  async findDatasetForOptimization(projectId: string, datasetId: string): Promise<{ id: string; name: string } | null> {
    const rows = await this.db
      .select({ id: datasets.id, name: datasets.name })
      .from(datasets)
      .where(
        and(
          eq(datasets.projectId, projectId),
          eq(datasets.id, datasetId),
          eq(datasets.status, 'active'),
          isNull(datasets.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveExperimentByProjectAndName(projectId: string, name: string): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: experiments.id })
      .from(experiments)
      .where(and(eq(experiments.projectId, projectId), eq(experiments.name, name), isNull(experiments.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Called by the workflow after the first version is generated in from_dataset_only mode, writing the generated version id into base_version_id.
   * Guarded by `WHERE base_version_id IS NULL` so DBOS step replay does not overwrite an existing value.
   * See SPEC 25 §2.1.
   */
  async updateBaseVersionId(optimizationId: string, baseVersionId: string): Promise<void> {
    await this.db
      .update(optimizations)
      .set({ baseVersionId, updatedAt: new Date() })
      .where(
        and(eq(optimizations.id, optimizationId), isNull(optimizations.baseVersionId), isNull(optimizations.deletedAt)),
      );
  }

  // ---------- Workflow-side ----------

  async setDbosWorkflowId(optimizationId: string, workflowId: string): Promise<void> {
    await this.db
      .update(optimizations)
      .set({ dbosWorkflowId: workflowId, updatedAt: new Date() })
      .where(eq(optimizations.id, optimizationId));
  }

  async findActiveRunningWithWorkflow(): Promise<OptimizationActiveRunningRow[]> {
    const rows = await this.db
      .select({
        optimizationId: optimizations.id,
        projectId: optimizations.projectId,
        dbosWorkflowId: optimizations.dbosWorkflowId,
      })
      .from(optimizations)
      .where(
        and(
          eq(optimizations.status, 'running'),
          isNull(optimizations.finishedAt),
          isNull(optimizations.deletedAt),
          isNotNull(optimizations.dbosWorkflowId),
        ),
      );
    return rows.filter(
      (r): r is { optimizationId: string; projectId: string; dbosWorkflowId: string } => r.dbosWorkflowId !== null,
    );
  }

  async markStarted(optimizationId: string): Promise<void> {
    // Only populate when startedAt is not yet set, to avoid resume overwriting the original startedAt
    // started_at uses the DB's now() to avoid drizzle raw sql template skipping column type serialization, which would cause a postgres-js Bind failure
    await this.db
      .update(optimizations)
      .set({
        status: 'running',
        startedAt: sql`COALESCE(${optimizations.startedAt}, now())`,
        finishedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(optimizations.id, optimizationId), isNull(optimizations.deletedAt)));
  }

  async clearResume(optimizationId: string): Promise<void> {
    await this.db
      .update(optimizations)
      .set({ controlState: null, status: 'running', updatedAt: new Date() })
      .where(and(eq(optimizations.id, optimizationId), eq(optimizations.controlState, 'resume')));
  }

  async readControlState(optimizationId: string): Promise<string | null> {
    const rows = await this.db
      .select({ controlState: optimizations.controlState })
      .from(optimizations)
      .where(eq(optimizations.id, optimizationId))
      .limit(1);
    return rows[0]?.controlState ?? null;
  }

  // Used at the top of the workflow main loop + inside poll: fetches status + control_state at once.
  // Cooperates with service.controlOptimization's preemptive terminal-state write — when the workflow sees status no longer running,
  // it exits immediately, no more finalize, no more starting child experiments.
  async findStatusAndControl(optimizationId: string): Promise<{ status: string; controlState: string | null } | null> {
    const rows = await this.db
      .select({ status: optimizations.status, controlState: optimizations.controlState })
      .from(optimizations)
      .where(eq(optimizations.id, optimizationId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { status: row.status, controlState: row.controlState };
  }

  async updateBest(optimizationId: string, bestVersionId: string, bestMetrics: unknown): Promise<void> {
    await this.db
      .update(optimizations)
      .set({ bestVersionId, bestMetrics, updatedAt: new Date() })
      .where(and(eq(optimizations.id, optimizationId), isNull(optimizations.deletedAt)));
  }

  async updateCurrentRound(optimizationId: string, round: number): Promise<void> {
    await this.db
      .update(optimizations)
      .set({ currentRound: round, updatedAt: new Date() })
      .where(and(eq(optimizations.id, optimizationId), isNull(optimizations.deletedAt)));
  }

  async attachSourceExperimentIfEmpty(optimizationId: string, experimentId: string): Promise<void> {
    await this.db
      .update(optimizations)
      .set({ sourceExperimentId: experimentId, updatedAt: new Date() })
      .where(
        and(
          eq(optimizations.id, optimizationId),
          isNull(optimizations.sourceExperimentId),
          isNull(optimizations.deletedAt),
        ),
      );
  }

  async freezePromptVersionIfNeeded(promptVersionId: string): Promise<void> {
    await this.db
      .update(promptVersions)
      .set({ isFrozen: true, frozenAt: sql`COALESCE(${promptVersions.frozenAt}, now())` })
      .where(and(eq(promptVersions.id, promptVersionId), eq(promptVersions.isFrozen, false)));
  }

  async createPromptBaselineExperimentRow(input: {
    id: string;
    projectId: string;
    name: string;
    promptVersionId: string;
    datasetId: string;
    modelId: string;
    runConfig: unknown;
    totalSamples: number;
    createdBy: string;
  }): Promise<string> {
    const [row] = await this.db
      .insert(experiments)
      .values({
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        promptVersionId: input.promptVersionId,
        datasetId: input.datasetId,
        modelId: input.modelId,
        status: 'running',
        startedAt: new Date(),
        runConfig: (input.runConfig as Record<string, unknown>) ?? {},
        totalSamples: input.totalSamples,
        createdBy: input.createdBy,
      })
      .onConflictDoNothing({ target: experiments.id })
      .returning({ id: experiments.id });
    return row?.id ?? input.id;
  }

  async setExperimentDbosWorkflowId(experimentId: string, workflowId: string): Promise<void> {
    await this.db
      .update(experiments)
      .set({ dbosWorkflowId: workflowId, updatedAt: new Date() })
      .where(eq(experiments.id, experimentId));
  }

  async findExperimentStatus(
    experimentId: string,
  ): Promise<{ id: string; projectId: string; status: string; controlState: string | null; metrics: unknown } | null> {
    const rows = await this.db
      .select({
        id: experiments.id,
        projectId: experiments.projectId,
        status: experiments.status,
        controlState: experiments.controlState,
        metrics: experiments.metrics,
      })
      .from(experiments)
      .where(and(eq(experiments.id, experimentId), isNull(experiments.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  // Idempotency guard: only allow transitioning from status='running' to a terminal state. Returns whether the write actually happened.
  // After service performs a preemptive terminal write (writing status in one shot on stop/cancel), the workflow's own finalize
  // is skipped because the WHERE clause does not match — avoiding overwriting the terminal state set by service and avoiding finished_at drift.
  async finalize(
    optimizationId: string,
    status: 'success' | 'failed' | 'stopped' | 'cancelled',
    options: { summary?: unknown; objectiveStatus?: string; analysisFailureReason?: string | null } = {},
  ): Promise<boolean> {
    const now = new Date();
    const rows = await this.db
      .update(optimizations)
      .set({
        status,
        objectiveStatus: options.objectiveStatus ?? sql`${optimizations.objectiveStatus}`,
        controlState: null,
        finishedAt: now,
        updatedAt: now,
        summary: options.summary ?? sql`${optimizations.summary}`,
        analysisFailureReason:
          options.analysisFailureReason !== undefined
            ? options.analysisFailureReason
            : sql`${optimizations.analysisFailureReason}`,
      })
      .where(
        and(eq(optimizations.id, optimizationId), isNull(optimizations.deletedAt), eq(optimizations.status, 'running')),
      )
      .returning({ id: optimizations.id });
    return rows.length > 0;
  }

  async loadWorkflowContext(optimizationId: string): Promise<OptimizationWorkflowContext | null> {
    const baseVersionAlias = alias(promptVersions, 'base_version');
    const rows = await this.db
      .select({
        id: optimizations.id,
        projectId: optimizations.projectId,
        name: optimizations.name,
        description: optimizations.description,
        optimizationHint: optimizations.optimizationHint,
        strategy: optimizations.strategy,
        strategyConfig: optimizations.strategyConfig,
        startingMode: optimizations.startingMode,
        sourceExperimentId: optimizations.sourceExperimentId,
        promptId: optimizations.promptId,
        baseVersionId: optimizations.baseVersionId,
        baseVersionBody: baseVersionAlias.body,
        baseVersionVariables: baseVersionAlias.variables,
        baseVersionOutputSchema: baseVersionAlias.outputSchema,
        baseVersionJudgmentRules: baseVersionAlias.judgmentRules,
        baseVersionPromptLanguage: baseVersionAlias.promptLanguage,
        baseVersionNumber: baseVersionAlias.versionNumber,
        datasetId: optimizations.datasetId,
        datasetSampleCount: datasets.sampleCount,
        experimentModelId: optimizations.experimentModelId,
        analysisModelId: optimizations.analysisModelId,
        promptLanguage: optimizations.promptLanguage,
        goals: optimizations.goals,
        fieldWhitelist: optimizations.fieldWhitelist,
        runConfig: optimizations.runConfig,
        maxRounds: optimizations.maxRounds,
        stopAfterNoImprovementRounds: optimizations.stopAfterNoImprovementRounds,
        currentRound: optimizations.currentRound,
        bestVersionId: optimizations.bestVersionId,
        bestMetrics: optimizations.bestMetrics,
        status: optimizations.status,
        controlState: optimizations.controlState,
        startedAt: optimizations.startedAt,
        finishedAt: optimizations.finishedAt,
        createdBy: optimizations.createdBy,
      })
      .from(optimizations)
      .innerJoin(datasets, eq(datasets.id, optimizations.datasetId))
      .leftJoin(baseVersionAlias, eq(baseVersionAlias.id, optimizations.baseVersionId))
      .where(and(eq(optimizations.id, optimizationId), isNull(optimizations.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findExperimentByRound(
    optimizationId: string,
    roundIndex: number,
  ): Promise<{
    id: string;
    roundIndex: number;
    status: string;
    metrics: unknown;
    promptVersionId: string;
    parentVersionId: string | null;
    failureReason: string | null;
    finishedAt: Date | null;
  } | null> {
    const rows = await this.db
      .select({
        id: experiments.id,
        roundIndex: experiments.roundIndex,
        status: experiments.status,
        metrics: experiments.metrics,
        promptVersionId: experiments.promptVersionId,
        parentVersionId: promptVersions.parentVersionId,
        failureReason: experiments.failureReason,
        finishedAt: experiments.finishedAt,
      })
      .from(experiments)
      .leftJoin(promptVersions, eq(promptVersions.id, experiments.promptVersionId))
      .where(
        and(
          eq(experiments.optimizationId, optimizationId),
          eq(experiments.roundIndex, roundIndex),
          isNull(experiments.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || row.roundIndex === null) return null;
    return { ...row, roundIndex: row.roundIndex };
  }

  async findAnalysisExperimentForPromptVersion(input: {
    optimizationId: string;
    sourceExperimentId: string | null;
    promptVersionId: string;
  }): Promise<OptimizationAnalysisExperimentRow | null> {
    if (input.sourceExperimentId) {
      const sourceRows = await this.db
        .select({
          id: experiments.id,
          roundIndex: experiments.roundIndex,
          metrics: experiments.metrics,
          promptVersionId: experiments.promptVersionId,
        })
        .from(experiments)
        .where(
          and(
            eq(experiments.id, input.sourceExperimentId),
            eq(experiments.promptVersionId, input.promptVersionId),
            isNull(experiments.deletedAt),
          ),
        )
        .limit(1);
      if (sourceRows[0]) {
        return { ...sourceRows[0], roundIndex: null };
      }
    }

    const childRows = await this.db
      .select({
        id: experiments.id,
        roundIndex: experiments.roundIndex,
        metrics: experiments.metrics,
        promptVersionId: experiments.promptVersionId,
      })
      .from(experiments)
      .where(
        and(
          eq(experiments.optimizationId, input.optimizationId),
          eq(experiments.promptVersionId, input.promptVersionId),
          isNotNull(experiments.roundIndex),
          isNull(experiments.deletedAt),
        ),
      )
      .orderBy(desc(experiments.roundIndex), desc(experiments.createdAt))
      .limit(1);
    const child = childRows[0];
    if (!child || child.roundIndex === null) return null;
    return child;
  }

  async findPreviousComparableExperiment(input: {
    optimizationId: string;
    sourceExperimentId: string | null;
    currentRoundIndex: number | null;
  }): Promise<OptimizationAnalysisExperimentRow | null> {
    if (input.currentRoundIndex === null) return null;
    if (input.currentRoundIndex <= 1) {
      if (!input.sourceExperimentId) return null;
      const rows = await this.db
        .select({
          id: experiments.id,
          roundIndex: experiments.roundIndex,
          metrics: experiments.metrics,
          promptVersionId: experiments.promptVersionId,
        })
        .from(experiments)
        .where(and(eq(experiments.id, input.sourceExperimentId), isNull(experiments.deletedAt)))
        .limit(1);
      return rows[0] ? { ...rows[0], roundIndex: null } : null;
    }

    const prev = await this.findExperimentByRound(input.optimizationId, input.currentRoundIndex - 1);
    if (!prev) return null;
    return {
      id: prev.id,
      roundIndex: input.currentRoundIndex - 1,
      metrics: prev.metrics,
      promptVersionId: prev.promptVersionId,
    };
  }

  async createChildExperimentRow(input: {
    id: string;
    projectId: string;
    name: string;
    promptVersionId: string;
    datasetId: string;
    modelId: string;
    optimizationId: string;
    roundIndex: number;
    runConfig: unknown;
    totalSamples: number;
    createdBy: string;
  }): Promise<string> {
    const [row] = await this.db
      .insert(experiments)
      .values({
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        promptVersionId: input.promptVersionId,
        datasetId: input.datasetId,
        modelId: input.modelId,
        optimizationId: input.optimizationId,
        roundIndex: input.roundIndex,
        status: 'running',
        startedAt: new Date(),
        runConfig: (input.runConfig as Record<string, unknown>) ?? {},
        totalSamples: input.totalSamples,
        createdBy: input.createdBy,
      })
      .onConflictDoNothing({ target: experiments.id })
      .returning({ id: experiments.id });
    return row?.id ?? input.id;
  }

  async markChildExperimentFailed(experimentId: string, failureReason: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(experiments)
      .set({
        status: 'failed',
        failureKind: 'internal',
        failureReason,
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(eq(experiments.id, experimentId), isNull(experiments.deletedAt)));
  }

  async findExistingOptimizationRunResult(
    optimizationId: string,
    roundIndex: number,
    source: 'optimization_analysis' | 'optimization_generate',
    options: { statusFilter?: 'success' } = {},
  ): Promise<{ id: string; parsedOutput: unknown; rawResponse: string | null; status: string } | null> {
    const conditions = [
      eq(runResults.sourceId, optimizationId),
      eq(runResults.source, source),
      eq(runResults.roundIndex, roundIndex),
    ];
    if (options.statusFilter) conditions.push(eq(runResults.status, options.statusFilter));
    const rows = await this.db
      .select({
        id: runResults.id,
        parsedOutput: runResults.parsedOutput,
        rawResponse: runResults.rawResponse,
        status: runResults.status,
      })
      .from(runResults)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ?? null;
  }

  // Look up the child experiment that is still running (or stopped but not terminal) within the current optimization (the row with the largest round_index).
  // Use case: service.controlOptimization locates the target when immediately propagating stop/cancel to the child experiment.
  // The baseline experiment in from_prompt_version has no optimization_id + round_index back-pointer,
  // but source_experiment_id points to it; if a regular round is not present, fall back to locating this baseline experiment.
  // Exclude terminal states (success/failed); only return running/stopped that genuinely need linkage.
  async findActiveChildExperiment(
    optimizationId: string,
  ): Promise<{ id: string; status: string; roundIndex: number | null; projectId: string } | null> {
    const rows = await this.db
      .select({
        id: experiments.id,
        status: experiments.status,
        roundIndex: experiments.roundIndex,
        projectId: experiments.projectId,
      })
      .from(experiments)
      .where(
        and(
          eq(experiments.optimizationId, optimizationId),
          isNotNull(experiments.roundIndex),
          isNull(experiments.deletedAt),
          sql`${experiments.status} NOT IN ('success','failed')`,
        ),
      )
      .orderBy(desc(experiments.roundIndex))
      .limit(1);
    const row = rows[0];
    if (row && row.roundIndex !== null) {
      return { id: row.id, status: row.status, roundIndex: row.roundIndex, projectId: row.projectId };
    }

    const baselineRows = await this.db
      .select({
        id: experiments.id,
        status: experiments.status,
        roundIndex: experiments.roundIndex,
        projectId: experiments.projectId,
      })
      .from(optimizations)
      .innerJoin(experiments, eq(experiments.id, optimizations.sourceExperimentId))
      .where(
        and(
          eq(optimizations.id, optimizationId),
          eq(optimizations.startingMode, 'from_prompt_version'),
          isNull(optimizations.deletedAt),
          isNull(experiments.deletedAt),
          sql`${experiments.status} NOT IN ('success','failed')`,
        ),
      )
      .limit(1);
    const baseline = baselineRows[0];
    if (!baseline) return null;
    return {
      id: baseline.id,
      status: baseline.status,
      roundIndex: baseline.roundIndex,
      projectId: baseline.projectId,
    };
  }

  // loadDatasetSamples moved to DatasetSampleRepository (08 §3.14); optimization.workflow injects that seam.

  async findPreviousRoundRunResults(input: {
    optimizationId: string;
    sourceExperimentId: string | null;
    currentRoundNumber: number;
  }): Promise<Array<{
    id: string;
    sampleId: string | null;
    parsedOutput: unknown;
    decisionOutput: string | null;
    isCorrect: boolean | null;
    errorMessage: string | null;
    rawResponse: string | null;
  }> | null> {
    if (input.currentRoundNumber <= 1) {
      // Round 1: return the source experiment's run_results; if there is no source experiment, return null
      if (!input.sourceExperimentId) return null;
      return this.loadRunResultsByExperiment(input.sourceExperimentId);
    }
    // Round N≥2: the N-1 round experiment
    const prev = await this.findExperimentByRound(input.optimizationId, input.currentRoundNumber - 1);
    if (!prev) return null;
    return this.loadRunResultsByExperiment(prev.id);
  }

  async loadRunResultsByExperiment(experimentId: string): Promise<OptimizationRunResultRow[]> {
    const rows = await this.db
      .select({
        id: runResults.id,
        sampleId: runResults.sampleId,
        parsedOutput: runResults.parsedOutput,
        decisionOutput: runResults.decisionOutput,
        isCorrect: runResults.isCorrect,
        errorMessage: runResults.errorMessage,
        rawResponse: runResults.rawResponse,
      })
      .from(runResults)
      .where(and(eq(runResults.source, 'experiment'), eq(runResults.sourceId, experimentId)));

    return rows.map((r) => ({
      id: r.id,
      sampleId: r.sampleId,
      decisionOutput: r.decisionOutput,
      isCorrect: r.isCorrect,
      errorMessage: r.errorMessage,
      parsedOutput: r.parsedOutput,
      rawResponse: r.rawResponse,
    }));
  }

  async listRoundExperimentsForOptimization(optimizationId: string): Promise<OptimizationRoundExperimentRow[]> {
    const rows = await this.db
      .select({
        experimentId: experiments.id,
        experimentName: experiments.name,
        roundIndex: experiments.roundIndex,
        promptVersionId: experiments.promptVersionId,
        promptVersionNumber: promptVersions.versionNumber,
        parentVersionId: promptVersions.parentVersionId,
        status: experiments.status,
        metrics: experiments.metrics,
        failureReason: experiments.failureReason,
        startedAt: experiments.startedAt,
        finishedAt: experiments.finishedAt,
        totalSamples: experiments.totalSamples,
        processedSamples: experiments.processedSamples,
        failedSamples: experiments.failedSamples,
        updatedAt: experiments.updatedAt,
      })
      .from(experiments)
      .leftJoin(promptVersions, eq(promptVersions.id, experiments.promptVersionId))
      .where(
        and(
          eq(experiments.optimizationId, optimizationId),
          isNotNull(experiments.roundIndex),
          isNull(experiments.deletedAt),
        ),
      )
      .orderBy(asc(experiments.roundIndex));
    const childRounds = rows
      .filter((r): r is (typeof rows)[number] & { roundIndex: number } => r.roundIndex !== null)
      .map((r) => ({ ...r, roundIndex: r.roundIndex }));

    const [sourceBaseline] = await this.db
      .select({
        experimentId: experiments.id,
        experimentName: experiments.name,
        promptVersionId: experiments.promptVersionId,
        promptVersionNumber: promptVersions.versionNumber,
        parentVersionId: promptVersions.parentVersionId,
        status: experiments.status,
        metrics: experiments.metrics,
        failureReason: experiments.failureReason,
        startedAt: experiments.startedAt,
        finishedAt: experiments.finishedAt,
        totalSamples: experiments.totalSamples,
        processedSamples: experiments.processedSamples,
        failedSamples: experiments.failedSamples,
        updatedAt: experiments.updatedAt,
      })
      .from(optimizations)
      .innerJoin(experiments, eq(experiments.id, optimizations.sourceExperimentId))
      .leftJoin(promptVersions, eq(promptVersions.id, experiments.promptVersionId))
      .where(
        and(
          eq(optimizations.id, optimizationId),
          eq(optimizations.startingMode, 'from_dataset_only'),
          isNull(optimizations.deletedAt),
          isNull(experiments.deletedAt),
        ),
      )
      .limit(1);

    if (!sourceBaseline || childRounds.some((r) => r.roundIndex === 0)) {
      return childRounds;
    }

    return [
      {
        ...sourceBaseline,
        roundIndex: 0,
        isBaseline: true,
      },
      ...childRounds,
    ].sort((a, b) => a.roundIndex - b.roundIndex);
  }

  async loadPromptVersionsByIds(
    versionIds: string[],
  ): Promise<
    Map<string, { body: string | null; versionNumber: number; outputSchema: unknown; promptLanguage?: string | null }>
  > {
    const result = new Map<
      string,
      { body: string | null; versionNumber: number; outputSchema: unknown; promptLanguage?: string | null }
    >();
    const unique = Array.from(new Set(versionIds.filter((id): id is string => Boolean(id))));
    if (unique.length === 0) return result;
    const rows = await this.db
      .select({
        id: promptVersions.id,
        body: promptVersions.body,
        versionNumber: promptVersions.versionNumber,
        outputSchema: promptVersions.outputSchema,
        promptLanguage: promptVersions.promptLanguage,
      })
      .from(promptVersions)
      .where(inArray(promptVersions.id, unique));
    for (const row of rows) {
      result.set(row.id, {
        body: row.body,
        versionNumber: row.versionNumber,
        outputSchema: row.outputSchema,
        promptLanguage: row.promptLanguage,
      });
    }
    return result;
  }

  // Picks the baseline version for from_prompt_version optimization (SPEC 25 §2).
  // Prefer prompts.current_online_version_id; otherwise take the version of this prompt with the largest versionNumber.
  async findActiveVersionIdForPrompt(promptId: string): Promise<string | null> {
    const [promptRow] = await this.db
      .select({ currentOnlineVersionId: prompts.currentOnlineVersionId })
      .from(prompts)
      .where(and(eq(prompts.id, promptId), eq(prompts.status, 'active'), isNull(prompts.deletedAt)))
      .limit(1);
    if (!promptRow) return null;
    if (promptRow.currentOnlineVersionId) return promptRow.currentOnlineVersionId;
    const [latestVersion] = await this.db
      .select({ id: promptVersions.id })
      .from(promptVersions)
      .where(eq(promptVersions.promptId, promptId))
      .orderBy(desc(promptVersions.versionNumber))
      .limit(1);
    return latestVersion?.id ?? null;
  }

  async findPromptVersionLanguage(versionId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ promptLanguage: promptVersions.promptLanguage })
      .from(promptVersions)
      .where(eq(promptVersions.id, versionId))
      .limit(1);
    return row?.promptLanguage ?? null;
  }

  async findUsablePromptVersion(
    projectId: string,
    versionId: string,
  ): Promise<{ id: string; promptId: string; promptStatus: string; promptDeletedAt: Date | null } | null> {
    const [row] = await this.db
      .select({
        id: promptVersions.id,
        promptId: promptVersions.promptId,
        promptStatus: prompts.status,
        promptDeletedAt: prompts.deletedAt,
      })
      .from(promptVersions)
      .innerJoin(prompts, eq(prompts.id, promptVersions.promptId))
      .where(and(eq(prompts.projectId, projectId), eq(promptVersions.id, versionId)))
      .limit(1);
    return row ?? null;
  }

  async listOptimizationLlmRunResults(optimizationId: string): Promise<OptimizationRoundLlmRow[]> {
    const rows = await this.db
      .select({
        runResultId: runResults.id,
        roundIndex: runResults.roundIndex,
        source: runResults.source,
        promptVersionId: runResults.promptVersionId,
        parsedOutput: runResults.parsedOutput,
        rawResponse: runResults.rawResponse,
        errorMessage: runResults.errorMessage,
        status: runResults.status,
        inputTokens: runResults.inputTokens,
        outputTokens: runResults.outputTokens,
        costEstimate: runResults.costEstimate,
        createdAt: runResults.createdAt,
      })
      .from(runResults)
      .where(
        and(
          eq(runResults.sourceId, optimizationId),
          inArray(runResults.source, ['optimization_analysis', 'optimization_generate']),
          isNotNull(runResults.roundIndex),
        ),
      );
    return rows
      .filter((r): r is OptimizationRoundLlmRow => r.roundIndex !== null)
      .map((r) => ({ ...r, roundIndex: r.roundIndex as number }));
  }

  // Cross-round history aggregation (SPEC 25 §11.3) — returns the completed rounds where round_index < beforeRoundIndex,
  // each row carrying this round's metrics / parentVersionId (from prompt_versions) / parsedOutput of optimization_generate /
  // is_best (anchored on optimizations.best_version_id). This method is read-only and can be wrapped by @DBOS.step.
  async loadRoundHistory(optimizationId: string, beforeRoundIndex: number): Promise<OptimizationRoundHistoryRow[]> {
    const rows = await this.db
      .select({
        roundIndex: experiments.roundIndex,
        metrics: experiments.metrics,
        promptVersionId: experiments.promptVersionId,
        parentVersionId: promptVersions.parentVersionId,
        generateParsedOutput: runResults.parsedOutput,
        bestVersionId: optimizations.bestVersionId,
      })
      .from(experiments)
      .leftJoin(promptVersions, eq(promptVersions.id, experiments.promptVersionId))
      .leftJoin(
        runResults,
        and(
          eq(runResults.sourceId, experiments.optimizationId),
          eq(runResults.roundIndex, experiments.roundIndex),
          eq(runResults.source, 'optimization_generate'),
          eq(runResults.status, 'success'),
        ),
      )
      .leftJoin(optimizations, eq(optimizations.id, experiments.optimizationId))
      .where(
        and(
          eq(experiments.optimizationId, optimizationId),
          isNotNull(experiments.roundIndex),
          sql`${experiments.roundIndex} < ${beforeRoundIndex}`,
          eq(experiments.status, 'success'),
          isNull(experiments.deletedAt),
        ),
      )
      .orderBy(asc(experiments.roundIndex));
    return rows
      .filter((r): r is typeof r & { roundIndex: number } => r.roundIndex !== null)
      .map((r) => ({
        roundIndex: r.roundIndex as number,
        metrics: r.metrics,
        promptVersionId: r.promptVersionId,
        parentVersionId: r.parentVersionId ?? null,
        generateParsedOutput: r.generateParsedOutput ?? null,
        isBest: r.bestVersionId !== null && r.bestVersionId === r.promptVersionId,
      }));
  }

  // Upsert idempotency core: at most one row per (optimizationId, roundIndex, step); DBOS step
  // retries that call multiple times do not duplicate rows. Fields not explicitly provided fall back via COALESCE(EXCLUDED.x, x),
  // preventing previously written finishedAt / runResultId / experimentId from being overwritten with null.
  async upsertRoundStep(input: RoundStepUpsertInput): Promise<void> {
    await this.db
      .insert(optimizationRoundSteps)
      .values({
        optimizationId: input.optimizationId,
        roundIndex: input.roundIndex,
        step: input.step,
        status: input.status,
        errorClass: input.errorClass ?? null,
        errorMessage: input.errorMessage ?? null,
        runResultId: input.runResultId ?? null,
        experimentId: input.experimentId ?? null,
        startedAt: input.startedAt ?? null,
        finishedAt: input.finishedAt ?? null,
        attempt: input.attempt ?? 0,
        dbosWorkflowId: input.dbosWorkflowId ?? null,
      })
      .onConflictDoUpdate({
        target: [optimizationRoundSteps.optimizationId, optimizationRoundSteps.roundIndex, optimizationRoundSteps.step],
        set: {
          status: sql`EXCLUDED.status`,
          // Partial-update fallback: only override when this call explicitly provides the field; otherwise keep the old value.
          errorClass:
            input.errorClass !== undefined ? sql`EXCLUDED.error_class` : sql`${optimizationRoundSteps.errorClass}`,
          errorMessage:
            input.errorMessage !== undefined
              ? sql`EXCLUDED.error_message`
              : sql`${optimizationRoundSteps.errorMessage}`,
          runResultId:
            input.runResultId !== undefined ? sql`EXCLUDED.run_result_id` : sql`${optimizationRoundSteps.runResultId}`,
          experimentId:
            input.experimentId !== undefined
              ? sql`EXCLUDED.experiment_id`
              : sql`${optimizationRoundSteps.experimentId}`,
          startedAt:
            input.startedAt !== undefined ? sql`EXCLUDED.started_at` : sql`${optimizationRoundSteps.startedAt}`,
          finishedAt:
            input.finishedAt !== undefined ? sql`EXCLUDED.finished_at` : sql`${optimizationRoundSteps.finishedAt}`,
          attempt: input.attempt !== undefined ? sql`EXCLUDED.attempt` : sql`${optimizationRoundSteps.attempt}`,
          dbosWorkflowId:
            input.dbosWorkflowId !== undefined
              ? sql`EXCLUDED.dbos_workflow_id`
              : sql`${optimizationRoundSteps.dbosWorkflowId}`,
          updatedAt: new Date(),
        },
      });
  }

  async listRoundStepsForOptimization(optimizationId: string): Promise<OptimizationRoundStepRow[]> {
    const rows = await this.db
      .select({
        optimizationId: optimizationRoundSteps.optimizationId,
        roundIndex: optimizationRoundSteps.roundIndex,
        step: optimizationRoundSteps.step,
        status: optimizationRoundSteps.status,
        errorClass: optimizationRoundSteps.errorClass,
        errorMessage: optimizationRoundSteps.errorMessage,
        runResultId: optimizationRoundSteps.runResultId,
        experimentId: optimizationRoundSteps.experimentId,
        startedAt: optimizationRoundSteps.startedAt,
        finishedAt: optimizationRoundSteps.finishedAt,
        attempt: optimizationRoundSteps.attempt,
        dbosWorkflowId: optimizationRoundSteps.dbosWorkflowId,
        createdAt: optimizationRoundSteps.createdAt,
        updatedAt: optimizationRoundSteps.updatedAt,
      })
      .from(optimizationRoundSteps)
      .where(eq(optimizationRoundSteps.optimizationId, optimizationId))
      .orderBy(asc(optimizationRoundSteps.roundIndex), asc(optimizationRoundSteps.step));
    return rows.map((r) => ({
      ...r,
      step: r.step as OptimizationRoundStepKind,
      status: r.status as OptimizationRoundStepStatus,
    }));
  }

  private runSelect(predicate: ReturnType<typeof and>) {
    return this.db
      .select(this.selectFields)
      .from(optimizations)
      .innerJoin(datasets, eq(datasets.id, optimizations.datasetId))
      .innerJoin(models, eq(models.id, optimizations.experimentModelId))
      .innerJoin(analysisModels, eq(analysisModels.id, optimizations.analysisModelId))
      .leftJoin(experiments, eq(experiments.id, optimizations.sourceExperimentId))
      .leftJoin(sourceExperimentPromptVersions, eq(sourceExperimentPromptVersions.id, experiments.promptVersionId))
      .leftJoin(prompts, eq(prompts.id, optimizations.promptId))
      .leftJoin(promptVersions, eq(promptVersions.id, optimizations.baseVersionId))
      .leftJoin(bestVersions, eq(bestVersions.id, optimizations.bestVersionId))
      .where(predicate);
  }
}
