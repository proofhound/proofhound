// Canary release compatibility repository: the source of truth is ph_releases.release_lines / release_line_events
// See docs/specs/27-releases.md and docs/specs/06-database-schema.md
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import type { RunResultPayloadRef } from '../run-result/run-result-payload';
import { RunResultPayloadReader } from '../run-result/run-result-payload.reader';

const {
  annotations,
  annotationTasks,
  connectors,
  datasets,
  models,
  projects,
  prompts,
  promptVersions,
  promptVersionLabels,
  runResults,
} = schema;

export interface CanaryReleaseRow {
  id: string;
  releaseLineId: string;
  projectId: string;
  name: string | null;
  description: string | null;
  promptVersionId: string;
  modelId: string;
  inputConnectorId: string;
  outputConnectorIds: string[];
  status: string;
  controlState: string | null;
  controlStatePayload: unknown;
  trafficRatio: string;
  trafficMode: string;
  runMode: string;
  stopConditions: unknown;
  recordMode: string;
  recordCategories: string[];
  filterRules: unknown;
  variableMapping: unknown;
  outputMapping: unknown;
  externalIdField: string;
  annotationSchema: unknown;
  storageCategories: string[];
  targetDatasetId: string | null;
  runConfig: unknown;
  promptSnapshot: Record<string, unknown>;
  promptVersionSnapshot: Record<string, unknown>;
  totalReceived: number;
  totalProcessed: number;
  totalFiltered: number;
  totalCorrect: number;
  totalErrors: number;
  metrics: unknown;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type CanaryReleaseInsertRow = CanaryReleaseRow;
export type AnnotationTaskRow = typeof annotationTasks.$inferSelect;
export type AnnotationTaskInsertRow = typeof annotationTasks.$inferInsert;
export type AnnotationRow = typeof annotations.$inferSelect & {
  externalId?: string | null;
  inputVariables?: unknown;
  renderedPrompt?: unknown;
  decisionOutput?: string | null;
  rawResponse?: string | null;
  parsedOutput?: unknown;
  latencyMs?: number | string | null;
  inputTokens?: number | string | null;
  outputTokens?: number | string | null;
};

export interface CanaryReleaseRowWithJoins extends CanaryReleaseRow {
  promptId: string | null;
  promptName: string | null;
  promptVersionNumber: number | null;
  modelName: string | null;
  modelProvider: string | null;
  inputConnectorName: string | null;
  inputConnectorType: string | null;
  targetDatasetName: string | null;
  createdByName: string | null;
  annotationTaskId: string | null;
  releaseVersionId: string | null;
  releaseVersionLabel: string | null;
}

export interface CanaryReleaseProjectAccessRow {
  id: string;
}

export interface CanaryQualityRow {
  category: string;
  count: number;
  submitted: number;
  correct: number;
}

export interface CanaryUsageTotals {
  canaryId: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
}

export interface CanaryParentProductionRow {
  id: string;
  projectId: string;
  promptId: string;
  promptVersionId: string;
  inputConnectorId: string | null;
  outputConnectorIds: string[];
  variableMapping: unknown;
  filterRules: unknown;
  externalIdField: string | null;
  submitReason: string;
}

@Injectable()
export class CanaryReleaseRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly db: DbClient,
    private readonly payloadReader: RunResultPayloadReader,
  ) {}

  // Canary run_results offload rendered_prompt + input_variables (SPEC 30 §9.4); resolve the joined
  // annotation rows' large fields through the seam before mapping. Pass-through when not offloaded.
  private async hydrateAnnotationRows(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const hydrated = await this.payloadReader.hydrateMany(
      rows.map((r) => ({
        renderedPrompt: r['rendered_prompt'] ?? null,
        inputVariables: r['input_variables'] ?? null,
        rawResponse: (r['raw_response'] as string | null) ?? null,
        parsedOutput: r['parsed_output'] ?? null,
        payloadRef: (r['payload_ref'] as RunResultPayloadRef | null) ?? null,
      })),
    );
    rows.forEach((r, i) => {
      const h = hydrated[i];
      if (!h) return;
      r['rendered_prompt'] = h.renderedPrompt;
      r['input_variables'] = h.inputVariables;
      r['raw_response'] = h.rawResponse;
      r['parsed_output'] = h.parsedOutput;
    });
    return rows;
  }

  async findProjectAccess(
    _actorUserId: string,
    projectId: string,
    _isSuperAdmin: boolean,
  ): Promise<CanaryReleaseProjectAccessRow | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByProject(projectId: string): Promise<CanaryReleaseRowWithJoins[]> {
    const rows = await this.db.execute(sql`
      ${canaryEventSelectSql()}
      WHERE e.project_id = ${projectId}::uuid
        AND e.lane_type = 'canary'
        AND e.status <> 'archived'
      ORDER BY e.created_at DESC
    `);
    return this.attachAnnotationTaskIds(unwrapRows<Record<string, unknown>>(rows).map(mapCanaryEventRow));
  }

  async findByIdWithJoins(projectId: string, canaryId: string): Promise<CanaryReleaseRowWithJoins | null> {
    const row = await this.findCanaryEventRow(projectId, canaryId);
    if (!row) return null;
    const enriched = await this.attachAnnotationTaskIds([row]);
    return enriched[0] ?? null;
  }

  async findById(canaryId: string): Promise<CanaryReleaseRow | null> {
    const row = await this.findCanaryEventRow(null, canaryId);
    return row ?? null;
  }

  async findRunningByInputConnector(inputConnectorId: string): Promise<CanaryReleaseRow | null> {
    const rows = await this.db.execute(sql`
      ${canaryEventSelectSql()}
      WHERE line.input_connector_id = ${inputConnectorId}::uuid
        AND e.id = line.active_canary_event_id
        AND e.lane_type = 'canary'
        AND e.status IN ('running', 'stopped')
      LIMIT 1
    `);
    const row = unwrapRows<Record<string, unknown>>(rows)[0];
    return row ? mapCanaryEventRow(row) : null;
  }

  async findRunningProductionByInputConnector(
    projectId: string,
    inputConnectorId: string,
  ): Promise<CanaryParentProductionRow | null> {
    const rows = await this.db.execute(sql`
      SELECT
        prod.id,
        prod.project_id,
        prod.prompt_id,
        prod.prompt_version_id,
        prod.input_connector_id,
        prod.output_connector_ids,
        prod.variable_mapping,
        prod.filter_rules,
        prod.external_id_field,
        prod.submit_reason
      FROM ph_releases.release_lines line
      INNER JOIN ph_releases.release_line_events prod ON prod.id = line.current_production_event_id
      WHERE line.project_id = ${projectId}::uuid
        AND line.input_connector_id = ${inputConnectorId}::uuid
        AND prod.lane_type = 'production'
        AND prod.status = 'running'
      LIMIT 1
    `);
    const row = unwrapRows<Record<string, unknown>>(rows)[0];
    return row
      ? {
          id: row['id'] as string,
          projectId: row['project_id'] as string,
          promptId: row['prompt_id'] as string,
          promptVersionId: row['prompt_version_id'] as string,
          inputConnectorId: (row['input_connector_id'] as string | null) ?? null,
          outputConnectorIds: normalizeStringArray(row['output_connector_ids']),
          variableMapping: row['variable_mapping'],
          filterRules: row['filter_rules'],
          externalIdField: (row['external_id_field'] as string | null) ?? null,
          submitReason: (row['submit_reason'] as string | null) ?? '',
        }
      : null;
  }

  async findPromptVersionForProject(
    projectId: string,
    versionId: string,
  ): Promise<{
    id: string;
    promptId: string;
    promptName: string | null;
    promptDefaultDatasetId: string | null;
    versionNumber: number;
    body: string | null;
    variables: unknown;
    outputSchema: unknown;
    judgmentRules: unknown;
    promptLanguage: string;
    isFrozen: boolean;
    createdBy: string;
    createdAt: Date;
    frozenAt: Date | null;
  } | null> {
    const rows = await this.db
      .select({
        id: promptVersions.id,
        promptId: promptVersions.promptId,
        promptName: prompts.name,
        promptDefaultDatasetId: prompts.defaultDatasetId,
        versionNumber: promptVersions.versionNumber,
        body: promptVersions.body,
        variables: promptVersions.variables,
        outputSchema: promptVersions.outputSchema,
        judgmentRules: promptVersions.judgmentRules,
        promptLanguage: promptVersions.promptLanguage,
        isFrozen: promptVersions.isFrozen,
        createdBy: promptVersions.createdBy,
        createdAt: promptVersions.createdAt,
        frozenAt: promptVersions.frozenAt,
      })
      .from(promptVersions)
      .innerJoin(prompts, eq(prompts.id, promptVersions.promptId))
      .where(
        and(
          eq(prompts.projectId, projectId),
          eq(promptVersions.id, versionId),
          eq(prompts.status, 'active'),
          isNull(prompts.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async freezePromptVersionIfNeeded(promptVersionId: string): Promise<void> {
    await this.db
      .update(promptVersions)
      .set({ isFrozen: true, frozenAt: sql`COALESCE(${promptVersions.frozenAt}, now())` })
      .where(and(eq(promptVersions.id, promptVersionId), eq(promptVersions.isFrozen, false)));
  }

  async markPromptVersionCanary(promptId: string, versionId: string, actorUserId: string): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(promptVersions)
        .set({ isFrozen: true, frozenAt: sql`COALESCE(${promptVersions.frozenAt}, now())` })
        .where(eq(promptVersions.id, versionId));
      await tx
        .insert(promptVersionLabels)
        .values({
          promptId,
          versionId,
          label: 'canary',
          labelType: 'system',
          createdBy: actorUserId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [promptVersionLabels.promptId, promptVersionLabels.label],
          set: { versionId, labelType: 'system', updatedAt: now },
        });
    });
  }

  async findModelById(modelId: string): Promise<{ id: string; name: string; providerType: string } | null> {
    const rows = await this.db
      .select({ id: models.id, name: models.name, providerType: models.providerType })
      .from(models)
      .where(and(eq(models.id, modelId), isNull(models.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findConnectorForProject(
    projectId: string,
    connectorId: string,
  ): Promise<{ id: string; name: string; type: string; direction: string } | null> {
    const rows = await this.db
      .select({ id: connectors.id, name: connectors.name, type: connectors.type, direction: connectors.direction })
      .from(connectors)
      .where(and(eq(connectors.projectId, projectId), eq(connectors.id, connectorId), isNull(connectors.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listConnectorsForProject(
    projectId: string,
    ids: string[],
  ): Promise<Array<{ id: string; name: string; type: string; direction: string }>> {
    if (ids.length === 0) return [];
    return this.db
      .select({ id: connectors.id, name: connectors.name, type: connectors.type, direction: connectors.direction })
      .from(connectors)
      .where(and(eq(connectors.projectId, projectId), inArray(connectors.id, ids), isNull(connectors.deletedAt)));
  }

  async findDatasetForProject(projectId: string, datasetId: string): Promise<{ id: string; name: string } | null> {
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

  async findCanaryAnnotationTaskId(canaryId: string): Promise<string | null> {
    const rows = await this.db.execute(sql`
      SELECT t.id
      FROM ph_releases.annotation_tasks t
      WHERE t.scope = 'canary'
        AND t.release_line_event_id = ${canaryId}::uuid
      ORDER BY t.created_at DESC
      LIMIT 1
    `);
    return unwrapRows<{ id: string }>(rows)[0]?.id ?? null;
  }

  async getAnnotationProgress(
    canaryId: string,
  ): Promise<{ total: number; claimed: number; submitted: number; correct: number; wrong: number }> {
    const taskId = await this.findCanaryAnnotationTaskId(canaryId);
    if (!taskId) return { total: 0, claimed: 0, submitted: 0, correct: 0, wrong: 0 };
    const rows = await this.db
      .select({
        total: sql<number>`COUNT(*)::int`,
        claimed: sql<number>`COUNT(*) FILTER (
          WHERE ${annotations.lockedBy} IS NOT NULL
            AND ${annotations.submittedAt} IS NULL
            AND ${annotations.lockHeartbeatAt} >= NOW() - INTERVAL '5 min'
        )::int`,
        submitted: sql<number>`COUNT(*) FILTER (WHERE ${annotations.submittedAt} IS NOT NULL)::int`,
        correct: sql<number>`COUNT(*) FILTER (
          WHERE ${annotations.submittedAt} IS NOT NULL
            AND ${this.annotationCorrectnessSql()} IS TRUE
        )::int`,
        wrong: sql<number>`COUNT(*) FILTER (
          WHERE ${annotations.submittedAt} IS NOT NULL
            AND ${this.annotationCorrectnessSql()} IS FALSE
        )::int`,
      })
      .from(annotations)
      .leftJoin(runResults, eq(runResults.id, annotations.runResultId))
      .where(eq(annotations.taskId, taskId));
    return rows[0] ?? { total: 0, claimed: 0, submitted: 0, correct: 0, wrong: 0 };
  }

  async aggregateUsageByCanaryIds(canaryIds: string[]): Promise<Map<string, CanaryUsageTotals>> {
    if (canaryIds.length === 0) return new Map();
    const rows = await this.db.execute(sql`
      SELECT
        rr.source_id AS canary_id,
        COUNT(*)::int AS run_count,
        COALESCE(SUM(COALESCE(rr.input_tokens, 0)), 0)::int AS input_tokens,
        COALESCE(SUM(COALESCE(rr.output_tokens, 0)), 0)::int AS output_tokens,
        COALESCE(SUM(COALESCE(rr.cost_estimate, 0)), 0)::numeric AS cost_estimate
      FROM ph_runs.run_results rr
      WHERE rr.source = 'release'
        AND rr.source_id IN (${uuidList(canaryIds)})
      GROUP BY rr.source_id
    `);
    const map = new Map<string, CanaryUsageTotals>();
    for (const row of unwrapRows<Record<string, unknown>>(rows)) {
      const canaryId = row['canary_id'] as string;
      map.set(canaryId, {
        canaryId,
        runCount: Number(row['run_count'] ?? 0),
        inputTokens: Number(row['input_tokens'] ?? 0),
        outputTokens: Number(row['output_tokens'] ?? 0),
        costEstimate: Number(row['cost_estimate'] ?? 0),
      });
    }
    return map;
  }

  async aggregateQualityByCategory(canaryId: string): Promise<CanaryQualityRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        COALESCE(rr.decision_output, 'unknown') AS category,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE a.submitted_at IS NOT NULL)::int AS submitted,
        COUNT(*) FILTER (
          WHERE a.submitted_at IS NOT NULL
            AND COALESCE(
              a.is_correct,
              CASE
                WHEN a.fields ? 'judgment'
                  AND rr.decision_output IS NOT NULL
                THEN (a.fields->>'judgment') = rr.decision_output
                ELSE NULL
              END
            ) IS TRUE
        )::int AS correct
      FROM ph_runs.run_results rr
      LEFT JOIN ph_runs.annotations a ON a.run_result_id = rr.id
      WHERE rr.source = 'release'
        AND rr.source_id = ${canaryId}::uuid
      GROUP BY category
      ORDER BY count DESC, category ASC
    `);
    return unwrapRows<Record<string, unknown>>(rows).map((row) => ({
      category: String(row['category'] ?? 'unknown'),
      count: Number(row['count'] ?? 0),
      submitted: Number(row['submitted'] ?? 0),
      correct: Number(row['correct'] ?? 0),
    }));
  }

  async listAnnotations(
    canaryId: string,
    filter: { status?: 'pending' | 'claimed' | 'submitted'; limit: number; offset: number },
  ): Promise<AnnotationRow[]> {
    const taskId = await this.findCanaryAnnotationTaskId(canaryId);
    if (!taskId) return [];
    const whereSql = sql.join(this.buildAnnotationFilters(taskId, filter.status), sql` AND `);
    const rows = await this.db.execute(sql`
      SELECT
        a.id,
        a.run_result_id,
        a.run_result_created_at,
        a.task_id,
        ${this.annotationCorrectnessSqlForAliases()} AS is_correct,
        a.fields,
        a.notes,
        a.locked_by,
        a.locked_at,
        a.lock_heartbeat_at,
        a.submitted_at,
        a.submitted_by,
        a.created_at,
        a.updated_at,
        rr.external_id,
        rr.input_variables,
        rr.rendered_prompt,
        rr.decision_output,
        rr.raw_response,
        rr.parsed_output,
        rr.payload_ref,
        rr.latency_ms,
        rr.input_tokens,
        rr.output_tokens
      FROM ph_runs.annotations a
      LEFT JOIN ph_runs.run_results rr ON rr.id = a.run_result_id
      WHERE ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT ${filter.limit}
      OFFSET ${filter.offset}
    `);
    return (await this.hydrateAnnotationRows(unwrapRows<Record<string, unknown>>(rows))).map((row) =>
      this.mapAnnotationRow(row),
    );
  }

  async countAnnotations(canaryId: string, filter: { status?: 'pending' | 'claimed' | 'submitted' }): Promise<number> {
    const taskId = await this.findCanaryAnnotationTaskId(canaryId);
    if (!taskId) return 0;
    const whereSql = sql.join(this.buildAnnotationFilters(taskId, filter.status), sql` AND `);
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM ph_runs.annotations a
      WHERE ${whereSql}
    `);
    return Number(unwrapRows<Record<string, unknown>>(rows)[0]?.['total'] ?? 0);
  }

  async claimAnnotations(canaryId: string, actorUserId: string, batchSize: number): Promise<AnnotationRow[]> {
    const taskId = await this.findCanaryAnnotationTaskId(canaryId);
    if (!taskId) return [];
    const result = await this.db.execute(sql`
      WITH claimed AS (
        UPDATE ph_runs.annotations
        SET locked_by = ${actorUserId}::uuid,
            locked_at = NOW(),
            lock_heartbeat_at = NOW(),
            updated_at = NOW()
        WHERE id IN (
          SELECT id FROM ph_runs.annotations
          WHERE task_id = ${taskId}::uuid
            AND submitted_at IS NULL
            AND (locked_by IS NULL OR lock_heartbeat_at < NOW() - INTERVAL '5 min')
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${batchSize}
        )
        RETURNING *
      )
      SELECT
        a.id,
        a.run_result_id,
        a.run_result_created_at,
        a.task_id,
        COALESCE(
          a.is_correct,
          CASE
            WHEN a.submitted_at IS NOT NULL
              AND a.fields ? 'judgment'
              AND rr.decision_output IS NOT NULL
            THEN (a.fields->>'judgment') = rr.decision_output
            ELSE NULL
          END
        ) AS is_correct,
        a.fields,
        a.notes,
        a.locked_by,
        a.locked_at,
        a.lock_heartbeat_at,
        a.submitted_at,
        a.submitted_by,
        a.created_at,
        a.updated_at,
        rr.external_id,
        rr.input_variables,
        rr.rendered_prompt,
        rr.decision_output,
        rr.raw_response,
        rr.parsed_output,
        rr.payload_ref,
        rr.latency_ms,
        rr.input_tokens,
        rr.output_tokens
      FROM claimed a
      LEFT JOIN ph_runs.run_results rr ON rr.id = a.run_result_id
      ORDER BY a.created_at ASC;
    `);
    return (await this.hydrateAnnotationRows(unwrapRows<Record<string, unknown>>(result))).map((row) =>
      this.mapAnnotationRow(row),
    );
  }

  async submitAnnotation(
    annotationId: string,
    actorUserId: string,
    payload: { isCorrect: boolean | null; notes: string | null; fields: Record<string, unknown> },
  ): Promise<AnnotationRow | null> {
    const result = await this.db
      .update(annotations)
      .set({
        isCorrect: payload.isCorrect,
        notes: payload.notes,
        fields: payload.fields,
        submittedBy: actorUserId,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(annotations.id, annotationId), eq(annotations.lockedBy, actorUserId), isNull(annotations.submittedAt)),
      )
      .returning();
    return result[0] ?? null;
  }

  async releaseAnnotation(annotationId: string, actorUserId: string): Promise<AnnotationRow | null> {
    const result = await this.db
      .update(annotations)
      .set({ lockedBy: null, lockedAt: null, lockHeartbeatAt: null, updatedAt: new Date() })
      .where(
        and(eq(annotations.id, annotationId), eq(annotations.lockedBy, actorUserId), isNull(annotations.submittedAt)),
      )
      .returning();
    return result[0] ?? null;
  }

  private async findCanaryEventRow(
    projectId: string | null,
    canaryId: string,
  ): Promise<CanaryReleaseRowWithJoins | null> {
    const projectFilter = projectId ? sql`AND e.project_id = ${projectId}::uuid` : sql``;
    const rows = await this.db.execute(sql`
      ${canaryEventSelectSql()}
      WHERE e.lane_type = 'canary'
        ${projectFilter}
        AND e.id = ${canaryId}::uuid
      LIMIT 1
    `);
    const row = unwrapRows<Record<string, unknown>>(rows)[0];
    return row ? mapCanaryEventRow(row) : null;
  }

  private mapAnnotationRow(row: Record<string, unknown>): AnnotationRow {
    return {
      id: row['id'] as string,
      runResultId: row['run_result_id'] as string,
      runResultCreatedAt: new Date(row['run_result_created_at'] as string | Date),
      taskId: (row['task_id'] as string | null) ?? null,
      isCorrect: (row['is_correct'] as boolean | null) ?? null,
      fields: (row['fields'] as Record<string, unknown> | null) ?? {},
      notes: (row['notes'] as string | null) ?? null,
      lockedBy: (row['locked_by'] as string | null) ?? null,
      lockedAt: row['locked_at'] ? new Date(row['locked_at'] as string | Date) : null,
      lockHeartbeatAt: row['lock_heartbeat_at'] ? new Date(row['lock_heartbeat_at'] as string | Date) : null,
      submittedAt: row['submitted_at'] ? new Date(row['submitted_at'] as string | Date) : null,
      submittedBy: (row['submitted_by'] as string | null) ?? null,
      createdAt: new Date(row['created_at'] as string | Date),
      updatedAt: new Date(row['updated_at'] as string | Date),
      externalId: (row['external_id'] as string | null) ?? null,
      inputVariables: row['input_variables'],
      renderedPrompt: row['rendered_prompt'],
      decisionOutput: (row['decision_output'] as string | null) ?? null,
      rawResponse: (row['raw_response'] as string | null) ?? null,
      parsedOutput: row['parsed_output'],
      latencyMs: (row['latency_ms'] as number | string | null) ?? null,
      inputTokens: (row['input_tokens'] as number | string | null) ?? null,
      outputTokens: (row['output_tokens'] as number | string | null) ?? null,
    };
  }

  private annotationCorrectnessSql() {
    return sql<boolean | null>`COALESCE(
      ${annotations.isCorrect},
      CASE
        WHEN ${annotations.submittedAt} IS NOT NULL
          AND ${annotations.fields} ? 'judgment'
          AND ${runResults.decisionOutput} IS NOT NULL
        THEN (${annotations.fields}->>'judgment') = ${runResults.decisionOutput}
        ELSE NULL
      END
    )`;
  }

  private annotationCorrectnessSqlForAliases() {
    return sql<boolean | null>`COALESCE(
      a.is_correct,
      CASE
        WHEN a.submitted_at IS NOT NULL
          AND a.fields ? 'judgment'
          AND rr.decision_output IS NOT NULL
        THEN (a.fields->>'judgment') = rr.decision_output
        ELSE NULL
      END
    )`;
  }

  private buildAnnotationFilters(taskId: string, status?: 'pending' | 'claimed' | 'submitted') {
    const filters = [sql`a.task_id = ${taskId}::uuid`];
    if (status === 'pending') {
      filters.push(
        sql`a.submitted_at IS NULL`,
        sql`(a.locked_by IS NULL OR a.lock_heartbeat_at < NOW() - INTERVAL '5 min')`,
      );
    } else if (status === 'claimed') {
      filters.push(
        sql`a.locked_by IS NOT NULL`,
        sql`a.submitted_at IS NULL`,
        sql`a.lock_heartbeat_at >= NOW() - INTERVAL '5 min'`,
      );
    } else if (status === 'submitted') {
      filters.push(sql`a.submitted_at IS NOT NULL`);
    }
    return filters;
  }

  private async attachAnnotationTaskIds(
    rows: Array<Omit<CanaryReleaseRowWithJoins, 'annotationTaskId'> | CanaryReleaseRowWithJoins>,
  ): Promise<CanaryReleaseRowWithJoins[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const tasks = await this.db
      .select({ id: annotationTasks.id, releaseLineEventId: annotationTasks.releaseLineEventId })
      .from(annotationTasks)
      .where(and(inArray(annotationTasks.releaseLineEventId, ids), eq(annotationTasks.scope, 'canary')));
    const map = new Map<string, string>();
    for (const task of tasks) {
      if (task.releaseLineEventId) map.set(task.releaseLineEventId, task.id);
    }
    return rows.map((row) => ({
      ...row,
      annotationTaskId: map.get(row.id) ?? ('annotationTaskId' in row ? row.annotationTaskId : null) ?? null,
    }));
  }
}

function canaryEventSelectSql() {
  return sql`
    SELECT
      e.id,
      e.release_line_id,
      e.project_id,
      line.name,
      line.description,
      e.release_version_id,
      rv.kind AS release_version_kind,
      rv.production_version_number,
      rv.target_production_version_number,
      rv.candidate_number,
      e.prompt_id,
      e.prompt_name,
      e.prompt_version_id,
      e.prompt_version_number,
      e.model_id,
      e.input_connector_id,
      e.output_connector_ids,
      e.status,
      e.control_state,
      e.control_state_payload,
      e.traffic_ratio,
      e.traffic_mode,
      e.record_mode,
      e.record_categories,
      e.filter_rules,
      e.variable_mapping,
      e.output_mapping,
      e.external_id_field,
      e.run_config,
      e.prompt_snapshot,
      e.prompt_version_snapshot,
      e.total_received,
      e.total_processed,
      e.total_filtered,
      e.total_correct,
      e.total_errors,
      e.metrics,
      e.started_at,
      e.finished_at,
      e.created_by,
      e.created_at,
      e.updated_at,
      COALESCE(m.name, e.model_snapshot->>'name') AS model_name,
      COALESCE(m.provider_type, e.model_snapshot->>'providerType', e.model_snapshot->>'provider') AS model_provider,
      COALESCE(ic.name, e.input_connector_snapshot->>'name') AS input_connector_name,
      COALESCE(ic.type, e.input_connector_snapshot->>'type') AS input_connector_type,
      NULL::text AS target_dataset_name,
      NULL::text AS created_by_name
    FROM ph_releases.release_line_events e
    INNER JOIN ph_releases.release_lines line ON line.id = e.release_line_id
    LEFT JOIN ph_releases.release_versions rv ON rv.id = e.release_version_id
    LEFT JOIN ph_assets.models m ON m.id = e.model_id
    LEFT JOIN ph_assets.connectors ic ON ic.id = e.input_connector_id
  `;
}

function mapCanaryEventRow(row: Record<string, unknown>): CanaryReleaseRowWithJoins {
  const id = row['id'] as string;
  const runConfig = asRecord(row['run_config']);
  return {
    id,
    releaseLineId: row['release_line_id'] as string,
    projectId: row['project_id'] as string,
    name: (row['name'] as string | null) ?? null,
    description: (row['description'] as string | null) ?? null,
    promptVersionId: (row['prompt_version_id'] as string | null) ?? id,
    modelId: (row['model_id'] as string | null) ?? id,
    inputConnectorId: (row['input_connector_id'] as string | null) ?? id,
    outputConnectorIds: normalizeStringArray(row['output_connector_ids']),
    status: canaryStatusFromReleaseStatus(row['status'] as string),
    controlState: (row['control_state'] as string | null) ?? null,
    controlStatePayload: row['control_state_payload'],
    trafficRatio: String(row['traffic_ratio'] ?? '0'),
    trafficMode: (row['traffic_mode'] as string | null) ?? 'split',
    runMode: 'manual',
    stopConditions: runConfig['stopConditions'] ?? null,
    recordMode: (row['record_mode'] as string | null) ?? 'all',
    recordCategories: normalizeStringArray(row['record_categories']),
    filterRules: row['filter_rules'] ?? null,
    variableMapping: row['variable_mapping'] ?? [],
    outputMapping: row['output_mapping'] ?? [],
    externalIdField: (row['external_id_field'] as string | null) ?? 'id',
    annotationSchema: [],
    storageCategories: normalizeStringArray(row['record_categories']),
    targetDatasetId: null,
    runConfig,
    promptSnapshot: asRecord(row['prompt_snapshot']),
    promptVersionSnapshot: asRecord(row['prompt_version_snapshot']),
    totalReceived: Number(row['total_received'] ?? 0),
    totalProcessed: Number(row['total_processed'] ?? 0),
    totalFiltered: Number(row['total_filtered'] ?? 0),
    totalCorrect: Number(row['total_correct'] ?? 0),
    totalErrors: Number(row['total_errors'] ?? 0),
    metrics: row['metrics'] ?? null,
    startedAt: toDateOrNull(row['started_at']),
    finishedAt: toDateOrNull(row['finished_at']),
    createdBy: row['created_by'] as string,
    createdAt: toDateOrNull(row['created_at']) ?? new Date(0),
    updatedAt: toDateOrNull(row['updated_at']) ?? new Date(0),
    deletedAt: null,
    promptId: (row['prompt_id'] as string | null) ?? null,
    promptName: (row['prompt_name'] as string | null) ?? null,
    promptVersionNumber: toNumberOrNull(row['prompt_version_number'] as number | string | null),
    modelName: (row['model_name'] as string | null) ?? null,
    modelProvider: (row['model_provider'] as string | null) ?? null,
    inputConnectorName: (row['input_connector_name'] as string | null) ?? null,
    inputConnectorType: (row['input_connector_type'] as string | null) ?? null,
    targetDatasetName: null,
    createdByName: null,
    annotationTaskId: null,
    releaseVersionId: (row['release_version_id'] as string | null) ?? null,
    releaseVersionLabel: formatReleaseVersionLabel(row),
  };
}

function canaryStatusFromReleaseStatus(status: string): string {
  if (status === 'archived') return 'cancelled';
  if (
    status === 'running' ||
    status === 'stopped' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled'
  ) {
    return status;
  }
  return 'running';
}

function uuidList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

function unwrapRows<T = unknown>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) return (result as { rows?: T[] }).rows ?? [];
  return [];
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value as string);
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatReleaseVersionLabel(row: Record<string, unknown>): string | null {
  const kind = row['release_version_kind'];
  const targetProductionNumber = toNumberOrNull(row['target_production_version_number'] as number | string | null);
  if (!kind || !targetProductionNumber) return null;
  if (kind === 'production') {
    return `v${toNumberOrNull(row['production_version_number'] as number | string | null) ?? targetProductionNumber}`;
  }
  return `v${Math.max(0, targetProductionNumber - 1)}.${toNumberOrNull(row['candidate_number'] as number | string | null) ?? 0}`;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
