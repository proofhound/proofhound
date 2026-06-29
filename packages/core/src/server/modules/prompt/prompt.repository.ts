import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, max, or, sql, type SQL } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import {
  DEFAULT_PROMPT_LANGUAGE,
  type CreatePromptDto,
  type PromptJudgmentRulesDto,
  type PromptLanguageDto,
  type PromptOutputSchemaDto,
  type PromptVariableDto,
  type UpdatePromptDraftVersionDto,
} from '@proofhound/shared';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import { LOCAL_ACTOR_ID } from '../../common/actor-context';

const {
  optimizations,
  datasets,
  experiments,
  projects,
  prompts,
  promptVersions,
  promptVersionLabels,
  productionReleaseEvents,
  releaseLineEvents,
  releaseLines,
  runResults,
} = schema;

// The drizzle transaction handle passed to a `db.transaction` callback. The cascade helper only
// needs `execute`, but typing it as the full transaction keeps it interchangeable with `this.db`.
type PromptDbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export interface PromptProjectAccessRow {
  id: string;
}

export interface PromptRow {
  id: string;
  projectId: string;
  name: string;
  status: string;
  currentOnlineVersionId: string | null;
  defaultDatasetId: string | null;
  defaultDatasetName: string | null;
  createdBy: string;
  createdByDisplayName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}

export interface PromptVersionRow {
  id: string;
  promptId: string;
  versionNumber: number;
  body: string | null;
  variables: unknown;
  outputSchema: unknown;
  judgmentRules: unknown;
  promptLanguage: string;
  parentVersionId: string | null;
  generatedByOptimizationId: string | null;
  changeReason: string | null;
  isFrozen: boolean;
  createdBy: string;
  createdByDisplayName?: string | null;
  createdAt: Date;
  frozenAt: Date | null;
}

export interface PromptVersionLabelRow {
  promptId: string;
  versionId: string;
  label: string;
  labelType: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptVersionMetricsRow {
  promptVersionId: string;
  runCount: number;
  successCount: number;
  errorCount: number;
  correctCount: number;
  incorrectCount: number;
  medianLatencyMs: number | string | null;
  medianInputTokens: number | string | null;
  medianOutputTokens: number | string | null;
  totalInputTokens: number | string | null;
  totalOutputTokens: number | string | null;
  totalCostEstimate: number | string | null;
  firstRunAt: Date | null;
  lastRunAt: Date | null;
}

export interface PromptDeletionImpactQuery {
  projectId: string;
  promptId: string;
  versionIds: string[];
  generatedOptimizationIds: string[];
  includePromptShell: boolean;
}

export interface PromptDeletionImpactRow {
  id: string;
  name: string | null;
  status: string | null;
  promptId: string | null;
  promptVersionId: string | null;
  promptVersionNumber: number | null;
  createdAt: Date | null;
}

export interface PromptDeletionImpactRows {
  releaseLines: PromptDeletionImpactRow[];
  experiments: PromptDeletionImpactRow[];
  optimizations: PromptDeletionImpactRow[];
}

@Injectable()
export class PromptRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  private promptSelectFields = {
    id: prompts.id,
    projectId: prompts.projectId,
    name: prompts.name,
    status: prompts.status,
    currentOnlineVersionId: prompts.currentOnlineVersionId,
    defaultDatasetId: prompts.defaultDatasetId,
    defaultDatasetName: datasets.name,
    createdBy: prompts.createdBy,
    createdByDisplayName: sql<string | null>`CASE WHEN ${prompts.createdBy} = CAST(${LOCAL_ACTOR_ID} AS uuid) THEN 'Local User' ELSE NULL END`,
    createdAt: prompts.createdAt,
    updatedAt: prompts.updatedAt,
    archivedAt: prompts.archivedAt,
    deletedAt: prompts.deletedAt,
  };

  private promptVersionSelectFields = {
    id: promptVersions.id,
    promptId: promptVersions.promptId,
    versionNumber: promptVersions.versionNumber,
    body: promptVersions.body,
    variables: promptVersions.variables,
    outputSchema: promptVersions.outputSchema,
    judgmentRules: promptVersions.judgmentRules,
    promptLanguage: promptVersions.promptLanguage,
    parentVersionId: promptVersions.parentVersionId,
    generatedByOptimizationId: promptVersions.generatedByOptimizationId,
    changeReason: promptVersions.changeReason,
    isFrozen: promptVersions.isFrozen,
    createdBy: promptVersions.createdBy,
    createdByDisplayName: sql<string | null>`CASE WHEN ${promptVersions.createdBy} = CAST(${LOCAL_ACTOR_ID} AS uuid) THEN 'Local User' ELSE NULL END`,
    createdAt: promptVersions.createdAt,
    frozenAt: promptVersions.frozenAt,
  };

  async findProjectAccess(
    _actorUserId: string,
    projectId: string,
    _isSuperAdmin: boolean,
  ): Promise<PromptProjectAccessRow | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listPrompts(projectId: string): Promise<PromptRow[]> {
    return this.db
      .select(this.promptSelectFields)
      .from(prompts)
      .leftJoin(datasets, eq(datasets.id, prompts.defaultDatasetId))
      .where(and(eq(prompts.projectId, projectId), isNull(prompts.deletedAt)))
      .orderBy(desc(prompts.updatedAt), desc(prompts.createdAt));
  }

  async findPromptById(projectId: string, promptId: string): Promise<PromptRow | null> {
    const rows = await this.db
      .select(this.promptSelectFields)
      .from(prompts)
      .leftJoin(datasets, eq(datasets.id, prompts.defaultDatasetId))
      .where(and(eq(prompts.projectId, projectId), eq(prompts.id, promptId), isNull(prompts.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  async findPromptByProjectAndName(projectId: string, name: string): Promise<PromptRow | null> {
    const rows = await this.db
      .select(this.promptSelectFields)
      .from(prompts)
      .leftJoin(datasets, eq(datasets.id, prompts.defaultDatasetId))
      .where(and(eq(prompts.projectId, projectId), eq(prompts.name, name), isNull(prompts.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  async findDatasetInProject(projectId: string, datasetId: string): Promise<{ id: string; name: string } | null> {
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

  async archivePrompt(projectId: string, promptId: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(prompts)
      .set({ status: 'archived', archivedAt: now, updatedAt: now })
      .where(and(eq(prompts.projectId, projectId), eq(prompts.id, promptId), isNull(prompts.deletedAt)));
  }

  async restorePrompt(projectId: string, promptId: string): Promise<void> {
    await this.db
      .update(prompts)
      .set({ status: 'active', archivedAt: null, updatedAt: new Date() })
      .where(and(eq(prompts.projectId, projectId), eq(prompts.id, promptId), isNull(prompts.deletedAt)));
  }

  async listVersionsByPromptIds(promptIds: string[]): Promise<PromptVersionRow[]> {
    if (promptIds.length === 0) return [];

    return this.db
      .select(this.promptVersionSelectFields)
      .from(promptVersions)
      .where(inArray(promptVersions.promptId, promptIds))
      .orderBy(desc(promptVersions.versionNumber));
  }

  async listLabelsByPromptIds(promptIds: string[]): Promise<PromptVersionLabelRow[]> {
    if (promptIds.length === 0) return [];

    return this.db
      .select({
        promptId: promptVersionLabels.promptId,
        versionId: promptVersionLabels.versionId,
        label: promptVersionLabels.label,
        labelType: promptVersionLabels.labelType,
        createdAt: promptVersionLabels.createdAt,
        updatedAt: promptVersionLabels.updatedAt,
      })
      .from(promptVersionLabels)
      .where(inArray(promptVersionLabels.promptId, promptIds))
      .orderBy(promptVersionLabels.label);
  }

  async aggregateMetricsByVersionIds(projectId: string, versionIds: string[]): Promise<PromptVersionMetricsRow[]> {
    if (versionIds.length === 0) return [];

    return this.db
      .select({
        promptVersionId: runResults.promptVersionId,
        runCount: sql<number>`COUNT(*)::int`,
        successCount: sql<number>`COUNT(*) FILTER (WHERE ${runResults.status} = 'success')::int`,
        errorCount: sql<number>`COUNT(*) FILTER (WHERE ${runResults.status} <> 'success')::int`,
        correctCount: sql<number>`COUNT(*) FILTER (WHERE ${runResults.isCorrect} IS TRUE)::int`,
        incorrectCount: sql<number>`COUNT(*) FILTER (WHERE ${runResults.isCorrect} IS FALSE)::int`,
        medianLatencyMs: sql<
          number | null
        >`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${runResults.latencyMs}) FILTER (WHERE ${runResults.latencyMs} IS NOT NULL)`,
        medianInputTokens: sql<
          number | null
        >`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${runResults.inputTokens}) FILTER (WHERE ${runResults.inputTokens} IS NOT NULL)`,
        medianOutputTokens: sql<
          number | null
        >`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${runResults.outputTokens}) FILTER (WHERE ${runResults.outputTokens} IS NOT NULL)`,
        totalInputTokens: sql<number>`COALESCE(SUM(COALESCE(${runResults.inputTokens}, 0)), 0)::int`,
        totalOutputTokens: sql<number>`COALESCE(SUM(COALESCE(${runResults.outputTokens}, 0)), 0)::int`,
        totalCostEstimate: sql<string>`COALESCE(SUM(COALESCE(${runResults.costEstimate}, 0)), 0)::numeric`,
        firstRunAt: sql<Date | null>`MIN(${runResults.createdAt})`,
        lastRunAt: sql<Date | null>`MAX(${runResults.createdAt})`,
      })
      .from(runResults)
      .where(and(eq(runResults.projectId, projectId), inArray(runResults.promptVersionId, versionIds)))
      .groupBy(runResults.promptVersionId);
  }

  async listExperimentReferencesByVersionIds(versionIds: string[]) {
    if (versionIds.length === 0) return [];

    return this.db
      .select({
        id: experiments.id,
        promptVersionId: experiments.promptVersionId,
      })
      .from(experiments)
      .where(and(inArray(experiments.promptVersionId, versionIds), isNull(experiments.deletedAt)));
  }

  async listDeletionImpact(input: PromptDeletionImpactQuery): Promise<PromptDeletionImpactRows> {
    const experimentRows =
      input.versionIds.length > 0
        ? await this.db
            .select({
              id: experiments.id,
              name: experiments.name,
              status: experiments.status,
              promptId: promptVersions.promptId,
              promptVersionId: experiments.promptVersionId,
              promptVersionNumber: promptVersions.versionNumber,
              createdAt: experiments.createdAt,
            })
            .from(experiments)
            .leftJoin(promptVersions, eq(promptVersions.id, experiments.promptVersionId))
            .where(
              and(
                eq(experiments.projectId, input.projectId),
                inArray(experiments.promptVersionId, input.versionIds),
                isNull(experiments.deletedAt),
              ),
            )
        : [];

    const autoConditions: SQL[] = [];
    if (input.includePromptShell) autoConditions.push(eq(optimizations.promptId, input.promptId));
    if (input.versionIds.length > 0) {
      autoConditions.push(inArray(optimizations.baseVersionId, input.versionIds));
      autoConditions.push(inArray(optimizations.bestVersionId, input.versionIds));
    }
    if (input.generatedOptimizationIds.length > 0) {
      autoConditions.push(inArray(optimizations.id, input.generatedOptimizationIds));
    }
    const autoRows =
      autoConditions.length > 0
        ? await this.db
            .select({
              id: optimizations.id,
              name: optimizations.name,
              status: optimizations.status,
              promptId: optimizations.promptId,
              promptVersionId: sql<
                string | null
              >`COALESCE(${optimizations.baseVersionId}, ${optimizations.bestVersionId})`,
              promptVersionNumber: sql<number | null>`NULL`,
              createdAt: optimizations.createdAt,
            })
            .from(optimizations)
            .where(
              and(eq(optimizations.projectId, input.projectId), or(...autoConditions), isNull(optimizations.deletedAt)),
            )
        : [];

    const releaseLineConditions: SQL[] = [];
    if (input.includePromptShell) releaseLineConditions.push(eq(releaseLines.promptId, input.promptId));
    if (input.versionIds.length > 0) {
      releaseLineConditions.push(inArray(releaseLineEvents.promptVersionId, input.versionIds));
    }
    const rawReleaseLineRows =
      releaseLineConditions.length > 0
        ? await this.db
            .select({
              id: releaseLines.id,
              name: releaseLines.name,
              status: releaseLines.status,
              promptId: releaseLines.promptId,
              promptVersionId: sql<string | null>`NULL`,
              promptVersionNumber: sql<number | null>`NULL`,
              createdAt: releaseLines.createdAt,
            })
            .from(releaseLines)
            .leftJoin(
              releaseLineEvents,
              and(
                eq(releaseLineEvents.releaseLineId, releaseLines.id),
                eq(releaseLineEvents.projectId, input.projectId),
              ),
            )
            .where(
              and(
                eq(releaseLines.projectId, input.projectId),
                or(...releaseLineConditions),
              ),
            )
            .orderBy(desc(releaseLines.updatedAt))
        : [];
    const releaseLineRowsById = new Map<string, PromptDeletionImpactRow>();
    for (const row of rawReleaseLineRows) {
      if (!releaseLineRowsById.has(row.id)) releaseLineRowsById.set(row.id, row);
    }

    return {
      releaseLines: Array.from(releaseLineRowsById.values()),
      experiments: experimentRows,
      optimizations: autoRows,
    };
  }

  async createPrompt(projectId: string, dto: CreatePromptDto, actorUserId: string) {
    return this.db.transaction(async (tx) => {
      const [prompt] = await tx
        .insert(prompts)
        .values({
          projectId,
          name: dto.name,
          defaultDatasetId: dto.defaultDatasetId ?? null,
          createdBy: actorUserId,
        })
        .returning();

      if (!prompt) {
        throw new Error('Prompt insert returned no row');
      }

      const [version] = await tx
        .insert(promptVersions)
        .values({
          promptId: prompt.id,
          versionNumber: 1,
          body: '',
          variables: [],
          outputSchema: { fields: [] },
          judgmentRules: { rules: [] },
          promptLanguage: dto.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE,
          changeReason: '初始版本',
          isFrozen: false,
          createdBy: actorUserId,
        })
        .returning();

      if (!version) {
        throw new Error('Prompt version insert returned no row');
      }

      return { prompt, version };
    });
  }

  /**
   * from_dataset_only start mode: only insert a single prompts row as the carrier entity; do NOT create version 1.
   * The first version is written by OptimizationWorkflow's generateFirstVersionStep with a deterministic id.
   * If the `idx_prompts_name_active` unique constraint is hit, throw the original error and let the caller (service) retry with a hash suffix appended.
   * See SPEC 25 §2.1.
   */
  async createPlaceholderPromptForOptimization(input: {
    projectId: string;
    name: string;
    defaultDatasetId: string;
    createdBy: string;
  }): Promise<string> {
    const [row] = await this.db
      .insert(prompts)
      .values({
        projectId: input.projectId,
        name: input.name,
        defaultDatasetId: input.defaultDatasetId,
        createdBy: input.createdBy,
      })
      .returning({ id: prompts.id });
    if (!row) {
      throw new Error('placeholder prompt insert returned no row');
    }
    return row.id;
  }

  async updateDraftVersion(
    projectId: string,
    promptId: string,
    versionId: string,
    dto: UpdatePromptDraftVersionDto,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(promptVersions)
        .set({
          body: dto.body,
          variables: dto.variables as PromptVariableDto[],
          outputSchema: dto.outputSchema as PromptOutputSchemaDto,
          judgmentRules: dto.judgmentRules as PromptJudgmentRulesDto,
          promptLanguage: dto.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE,
          changeReason: dto.changeReason ?? null,
        })
        .where(and(eq(promptVersions.promptId, promptId), eq(promptVersions.id, versionId)));

      await tx
        .update(prompts)
        .set({ updatedAt: new Date() })
        .where(and(eq(prompts.projectId, projectId), eq(prompts.id, promptId)));
    });
  }

  async updatePromptDefaultDataset(projectId: string, promptId: string, defaultDatasetId: string): Promise<void> {
    await this.db
      .update(prompts)
      .set({ defaultDatasetId, updatedAt: new Date() })
      .where(and(eq(prompts.projectId, projectId), eq(prompts.id, promptId), isNull(prompts.deletedAt)));
  }

  async hardDeletePrompt(projectId: string, promptId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();

      // Prompt-level delete stops every running release lane that depends on this prompt.
      await tx
        .update(productionReleaseEvents)
        .set({
          status: 'stopped',
          stopReason: 'force_stopped',
          finishedAt: now,
          controlState: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(productionReleaseEvents.projectId, projectId),
            eq(productionReleaseEvents.promptId, promptId),
            eq(productionReleaseEvents.status, 'running'),
          ),
        );

      await tx
        .update(releaseLineEvents)
        .set({
          status: 'stopped',
          terminalReason: 'force_stopped',
          finishedAt: now,
          controlState: null,
          controlStatePayload: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(releaseLineEvents.projectId, projectId),
            eq(releaseLineEvents.promptId, promptId),
            eq(releaseLineEvents.status, 'running'),
          ),
        );

      await tx
        .update(releaseLines)
        .set({
          status: 'stopped',
          updatedAt: now,
        })
        .where(
          and(
            eq(releaseLines.projectId, projectId),
            eq(releaseLines.promptId, promptId),
            sql`${releaseLines.status} <> 'archived'`,
          ),
        );

      // Scope the cascade to every version of the prompt; also catch optimizations attached to the
      // prompt shell itself (placeholder / from_dataset_only optimizations).
      await this.cascadeDeleteForTargetVersions(
        tx,
        projectId,
        sql`
          SELECT id, generated_by_optimization_id
          FROM ph_assets.prompt_versions
          WHERE prompt_id = ${promptId}::uuid
        `,
        sql`o.prompt_id = ${promptId}::uuid`,
      );

      await tx.delete(prompts).where(and(eq(prompts.projectId, projectId), eq(prompts.id, promptId)));
    });
  }

  /**
   * Cascade-delete every experiment / optimization (and the run results, annotations, and
   * optimization round steps they own) that reference the versions produced by `targetVersionsSelect`,
   * and null out the `source_experiment_id` back-references that would otherwise dangle.
   *
   * `targetVersionsSelect` must yield `(id, generated_by_optimization_id)` rows. Callers scope it
   * either to a whole prompt (`hardDeletePrompt`) or to a single version (`deleteDraftVersionHard`),
   * keeping both delete paths on the same impact semantics (SPEC 23 §4.2 / §3).
   *
   * `extraOptimizationScope` lets the prompt-level path also pull in optimizations attached to the
   * prompt shell (e.g. placeholder / from_dataset_only optimizations whose base_version_id is null);
   * the version-level path omits it so it only removes optimizations that reference THIS version.
   *
   * Release snapshot rows (release_versions / release_line_events / production_release_events) are
   * intentionally left in place — they hold immutable snapshots kept for history; only their FK-less
   * `source_experiment_id` back-reference is nulled so the deleted experiment is not left dangling.
   */
  private async cascadeDeleteForTargetVersions(
    tx: PromptDbTransaction,
    projectId: string,
    targetVersionsSelect: SQL,
    extraOptimizationScope?: SQL,
  ): Promise<void> {
    const optimizationScope = extraOptimizationScope
      ? sql`${extraOptimizationScope}
            OR o.base_version_id IN (SELECT id FROM target_versions)`
      : sql`o.base_version_id IN (SELECT id FROM target_versions)`;

    // Shared CTE chain resolving the versions → optimizations → experiments → run results to delete.
    const targetSelections = sql`
      WITH target_versions AS (
        ${targetVersionsSelect}
      ),
      target_optimizations AS (
        SELECT DISTINCT o.id
        FROM ph_runs.optimizations o
        WHERE o.project_id = ${projectId}::uuid
          AND o.deleted_at IS NULL
          AND (
            ${optimizationScope}
            OR o.best_version_id IN (SELECT id FROM target_versions)
            OR o.id IN (
              SELECT generated_by_optimization_id
              FROM target_versions
              WHERE generated_by_optimization_id IS NOT NULL
            )
          )
      ),
      target_experiments AS (
        SELECT DISTINCT e.id
        FROM ph_runs.experiments e
        WHERE e.project_id = ${projectId}::uuid
          AND e.deleted_at IS NULL
          AND (
            e.prompt_version_id IN (SELECT id FROM target_versions)
            OR e.optimization_id IN (SELECT id FROM target_optimizations)
          )
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
          AND rr.source_id IN (SELECT id FROM target_optimizations)
        )
      )
    `;

    await tx.execute(sql`
      ${targetSelections}
      DELETE FROM ph_runs.annotations annotation
      USING target_run_results rr
      WHERE annotation.run_result_id = rr.id
        AND annotation.run_result_created_at = rr.created_at
    `);

    await tx.execute(sql`
      ${targetSelections}
      DELETE FROM ph_runs.run_results rr
      USING target_run_results target
      WHERE rr.id = target.id
        AND rr.created_at = target.created_at
    `);

    await tx.execute(sql`
      ${targetSelections}
      UPDATE ph_releases.release_line_events event
      SET source_experiment_id = NULL,
          updated_at = now()
      WHERE event.project_id = ${projectId}::uuid
        AND event.source_experiment_id IN (SELECT id FROM target_experiments)
    `);

    await tx.execute(sql`
      ${targetSelections}
      UPDATE ph_releases.production_release_events event
      SET source_experiment_id = NULL,
          updated_at = now()
      WHERE event.project_id = ${projectId}::uuid
        AND event.source_experiment_id IN (SELECT id FROM target_experiments)
    `);

    await tx.execute(sql`
      ${targetSelections}
      UPDATE ph_runs.optimizations optimization
      SET source_experiment_id = NULL,
          updated_at = now()
      WHERE optimization.project_id = ${projectId}::uuid
        AND optimization.source_experiment_id IN (SELECT id FROM target_experiments)
    `);

    await tx.execute(sql`
      ${targetSelections}
      DELETE FROM ph_runs.experiments experiment
      USING target_experiments target
      WHERE experiment.id = target.id
    `);

    await tx.execute(sql`
      ${targetSelections}
      DELETE FROM ph_runs.optimization_round_steps step
      USING target_optimizations target
      WHERE step.optimization_id = target.id
    `);

    await tx.execute(sql`
      ${targetSelections}
      DELETE FROM ph_runs.optimizations optimization
      USING target_optimizations target
      WHERE optimization.id = target.id
    `);
  }

  async findVersionInPrompt(promptId: string, versionId: string): Promise<PromptVersionRow | null> {
    const rows = await this.db
      .select(this.promptVersionSelectFields)
      .from(promptVersions)
      .where(and(eq(promptVersions.promptId, promptId), eq(promptVersions.id, versionId)))
      .limit(1);

    return rows[0] ?? null;
  }

  async createDraftVersionFromSource(
    promptId: string,
    sourceVersionId: string,
    actorUserId: string,
    changeReason: string,
  ): Promise<{ versionId: string; versionNumber: number; sourceVersionNumber: number }> {
    return this.db.transaction(async (tx) => {
      const [source] = await tx
        .select({
          id: promptVersions.id,
          promptId: promptVersions.promptId,
          versionNumber: promptVersions.versionNumber,
          body: promptVersions.body,
          variables: promptVersions.variables,
          outputSchema: promptVersions.outputSchema,
          judgmentRules: promptVersions.judgmentRules,
          promptLanguage: promptVersions.promptLanguage,
        })
        .from(promptVersions)
        .where(and(eq(promptVersions.promptId, promptId), eq(promptVersions.id, sourceVersionId)))
        .limit(1);

      if (!source) {
        throw new Error('source_version_not_found');
      }

      const [maxRow] = await tx
        .select({ value: max(promptVersions.versionNumber) })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, promptId));

      const nextVersionNumber = (maxRow?.value ?? 0) + 1;

      const [inserted] = await tx
        .insert(promptVersions)
        .values({
          promptId,
          versionNumber: nextVersionNumber,
          body: source.body ?? '',
          variables: source.variables as PromptVariableDto[],
          outputSchema: source.outputSchema as PromptOutputSchemaDto,
          judgmentRules: source.judgmentRules as PromptJudgmentRulesDto,
          promptLanguage: source.promptLanguage as PromptLanguageDto,
          parentVersionId: source.id,
          changeReason,
          isFrozen: false,
          createdBy: actorUserId,
        })
        .returning({ id: promptVersions.id });

      if (!inserted) {
        throw new Error('Prompt version insert returned no row');
      }

      await tx.update(prompts).set({ updatedAt: new Date() }).where(eq(prompts.id, promptId));

      return {
        versionId: inserted.id,
        versionNumber: nextVersionNumber,
        sourceVersionNumber: source.versionNumber,
      };
    });
  }

  async createBlankDraftVersion(
    promptId: string,
    actorUserId: string,
    changeReason: string,
  ): Promise<{ versionId: string; versionNumber: number }> {
    return this.db.transaction(async (tx) => {
      const [maxRow] = await tx
        .select({ value: max(promptVersions.versionNumber) })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, promptId));

      const nextVersionNumber = (maxRow?.value ?? 0) + 1;

      const [inserted] = await tx
        .insert(promptVersions)
        .values({
          promptId,
          versionNumber: nextVersionNumber,
          body: '',
          variables: [],
          outputSchema: null,
          judgmentRules: null,
          promptLanguage: DEFAULT_PROMPT_LANGUAGE,
          parentVersionId: null,
          changeReason,
          isFrozen: false,
          createdBy: actorUserId,
        })
        .returning({ id: promptVersions.id });

      if (!inserted) {
        throw new Error('Prompt version insert returned no row');
      }

      await tx.update(prompts).set({ updatedAt: new Date() }).where(eq(prompts.id, promptId));

      return {
        versionId: inserted.id,
        versionNumber: nextVersionNumber,
      };
    });
  }

  /**
   * Physically delete a single prompt version, applying the SAME permanent-delete impact semantics
   * as `hardDeletePrompt` but scoped to that one version (SPEC 23 §4.2): every experiment / optimization
   * (and their owned run results, annotations, and optimization round steps) that references THIS version
   * is cascade-deleted, and any running release lane that depends on THIS version is stopped — all in one
   * transaction so a rollback reverts the whole thing (SPEC 23 §4.2 last bullet).
   */
  async deleteDraftVersionHard(projectId: string, promptId: string, versionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();

      // Stop running release lanes that depend on THIS version (snapshots stay for history).
      await tx
        .update(productionReleaseEvents)
        .set({
          status: 'stopped',
          stopReason: 'force_stopped',
          finishedAt: now,
          controlState: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(productionReleaseEvents.projectId, projectId),
            eq(productionReleaseEvents.promptVersionId, versionId),
            eq(productionReleaseEvents.status, 'running'),
          ),
        );

      await tx
        .update(releaseLineEvents)
        .set({
          status: 'stopped',
          terminalReason: 'force_stopped',
          finishedAt: now,
          controlState: null,
          controlStatePayload: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(releaseLineEvents.projectId, projectId),
            eq(releaseLineEvents.promptVersionId, versionId),
            eq(releaseLineEvents.status, 'running'),
          ),
        );

      // Recompute the aggregate status of every line that ever pinned this version — do NOT blanket-stop
      // it. A line whose live production/canary slot runs a DIFFERENT version must stay 'running'; only a
      // line whose live slot was just force-stopped drops to 'stopped'. This mirrors lineStatus() and the
      // runner's barrier, which both key off the slot pointers (current_production_event_id /
      // active_canary_event_id), so the line status can never disagree with the events the runner
      // actually executes. Archived lines stay archived.
      await tx.execute(sql`
        UPDATE ph_releases.release_lines l
        SET status = CASE
              WHEN l.status = 'archived' THEN 'archived'
              WHEN EXISTS (
                SELECT 1
                FROM ph_releases.release_line_events e
                WHERE e.id IN (l.current_production_event_id, l.active_canary_event_id)
                  AND e.status = 'running'
              ) THEN 'running'
              ELSE 'stopped'
            END,
            updated_at = ${now}
        WHERE l.project_id = ${projectId}::uuid
          AND EXISTS (
            SELECT 1
            FROM ph_releases.release_line_events e2
            WHERE e2.release_line_id = l.id
              AND e2.prompt_version_id = ${versionId}::uuid
          )
      `);

      // Same cascade as the prompt-level delete, scoped to a single target version.
      await this.cascadeDeleteForTargetVersions(tx, projectId, sql`
        SELECT id, generated_by_optimization_id
        FROM ph_assets.prompt_versions
        WHERE prompt_id = ${promptId}::uuid
          AND id = ${versionId}::uuid
      `);

      // Removing the version row cascades prompt_version_labels (FK ON DELETE CASCADE).
      await tx
        .delete(promptVersions)
        .where(and(eq(promptVersions.promptId, promptId), eq(promptVersions.id, versionId)));

      await tx
        .update(prompts)
        .set({
          currentOnlineVersionId: sql`CASE WHEN ${prompts.currentOnlineVersionId} = ${versionId} THEN NULL ELSE ${prompts.currentOnlineVersionId} END`,
          updatedAt: now,
        })
        .where(eq(prompts.id, promptId));
    });
  }

  async upsertVersionLabel(input: {
    promptId: string;
    versionId: string;
    label: string;
    labelType: 'system' | 'custom';
    actorUserId: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .insert(promptVersionLabels)
        .values({
          promptId: input.promptId,
          versionId: input.versionId,
          label: input.label,
          labelType: input.labelType,
          createdBy: input.actorUserId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [promptVersionLabels.promptId, promptVersionLabels.label],
          set: {
            versionId: input.versionId,
            labelType: input.labelType,
            updatedAt: now,
          },
        });

      await tx.update(prompts).set({ updatedAt: now }).where(eq(prompts.id, input.promptId));
    });
  }

  async deleteVersionLabel(promptId: string, label: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(promptVersionLabels)
        .where(and(eq(promptVersionLabels.promptId, promptId), eq(promptVersionLabels.label, label)));

      await tx.update(prompts).set({ updatedAt: new Date() }).where(eq(prompts.id, promptId));
    });
  }

  /**
   * Called by the optimization workflow: creates a frozen prompt version with a deterministic id.
   * Multiple calls with the same (optimizationId, roundNumber) are idempotent — duplicate INSERTs are swallowed by primary key conflict,
   * and the existing row is returned (for DBOS step replay).
   */
  async createOptimizationFrozenVersion(input: {
    versionId: string;
    promptId: string;
    // In from_dataset_only mode the first version has no parent version → null; later rounds have a parent version → string
    parentVersionId: string | null;
    body: string;
    variables: PromptVariableDto[];
    outputSchema: PromptOutputSchemaDto;
    judgmentRules: PromptJudgmentRulesDto;
    promptLanguage: PromptLanguageDto;
    optimizationId: string;
    changeReason: string;
    createdBy: string;
  }): Promise<{ versionId: string; versionNumber: number }> {
    return this.db.transaction(async (tx) => {
      // Look up first — the deterministic id makes replay idempotent
      const [existing] = await tx
        .select({ id: promptVersions.id, versionNumber: promptVersions.versionNumber })
        .from(promptVersions)
        .where(eq(promptVersions.id, input.versionId))
        .limit(1);
      if (existing) {
        return { versionId: existing.id, versionNumber: existing.versionNumber };
      }

      const [maxRow] = await tx
        .select({ value: max(promptVersions.versionNumber) })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, input.promptId));
      const nextVersionNumber = (maxRow?.value ?? 0) + 1;

      const now = new Date();
      const [inserted] = await tx
        .insert(promptVersions)
        .values({
          id: input.versionId,
          promptId: input.promptId,
          versionNumber: nextVersionNumber,
          body: input.body,
          variables: input.variables,
          outputSchema: input.outputSchema,
          judgmentRules: input.judgmentRules,
          promptLanguage: input.promptLanguage,
          parentVersionId: input.parentVersionId,
          generatedByOptimizationId: input.optimizationId,
          changeReason: input.changeReason,
          isFrozen: true,
          frozenAt: now,
          createdBy: input.createdBy,
        })
        .returning({ id: promptVersions.id, versionNumber: promptVersions.versionNumber });

      if (!inserted) {
        throw new Error('optimization_prompt_version_insert_failed');
      }

      await tx.update(prompts).set({ updatedAt: now }).where(eq(prompts.id, input.promptId));

      return { versionId: inserted.id, versionNumber: inserted.versionNumber };
    });
  }
}
