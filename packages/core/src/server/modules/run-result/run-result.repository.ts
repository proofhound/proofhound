import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '@proofhound/db';
import type { ClassificationAggregateRow, JudgmentStatus, RunStatus } from '@proofhound/metrics';
import type {
  DatasetFieldSchemaRole,
  ReleaseRunResultCleanupFilterDto,
  ReleaseRunResultCleanupImpactDto,
  ReleaseRunResultLaneDto,
  ReleaseRunResultListItemDto,
  ReleaseRunResultListResponseDto,
  RunResultDatasetFieldValueDto,
  RunResultDetailDto,
  RunResultJudgmentStatusDto,
  RunResultListItemDto,
  RunResultListQueryDto,
  RunResultListResponseDto,
  RunResultReleaseListQueryDto,
  RunResultStatusDto,
} from '@proofhound/shared';
import { sql, type SQL } from 'drizzle-orm';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import type { StoredObjectRef } from '../../common/contracts/object-storage.provider';
import { DatasetSamplePayloadReader, type DatasetSamplePayloadRef } from '../dataset/dataset-sample-payload';
import type { RunResultPayloadRef } from './run-result-payload';
import { collectStoredObjectRefs, sumStoredObjectBytes } from './run-result-payload-ref';
import { RunResultPayloadReader } from './run-result-payload.reader';

export interface BatchTerminalCounts {
  terminalCount: number;
  failedCount: number;
}

export interface ExperimentAccessRow {
  experimentId: string;
  projectId: string;
}

export interface ReleaseRunResultCleanupDeleteResult extends ReleaseRunResultCleanupImpactDto {
  payloadRefs: StoredObjectRef[];
}

export interface ReleaseRunResultRetentionTarget {
  projectId: string;
  sourceId: string;
  retentionDays: number;
  cutoff: string;
}

export interface ReleaseRunResultRetentionCleanup {
  target: ReleaseRunResultRetentionTarget;
  impact: ReleaseRunResultCleanupImpactDto;
  payloadRefs: StoredObjectRef[];
}

export interface ReleaseRunResultRetentionCleanupBatch {
  lockAcquired: boolean;
  targets: number;
  cleanups: ReleaseRunResultRetentionCleanup[];
}

export interface RunResultExportCursor {
  createdAt: string;
  id: string;
}

export interface RunResultExportBatch<T> {
  rows: T[];
  nextCursor: RunResultExportCursor | null;
}

export interface ReleaseRunResultExportItem extends ReleaseRunResultListItemDto {
  renderedPrompt: unknown | null;
}

@Injectable()
export class RunResultRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly db: DbClient,
    private readonly payloadReader: RunResultPayloadReader,
    private readonly samplePayloadReader: DatasetSamplePayloadReader,
  ) {}

  async aggregateExperimentLatency(experimentId: string): Promise<{
    averageMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
  }> {
    const rows = await this.db.execute<{
      avg_ms: number | string | null;
      p50_ms: number | string | null;
      p95_ms: number | string | null;
    }>(sql`
      SELECT
        AVG(latency_ms)::numeric AS avg_ms,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms
      FROM ph_runs.run_results
      WHERE source = 'experiment'
        AND source_id = ${experimentId}::uuid
        AND status = 'success'
        AND latency_ms IS NOT NULL
    `);

    const list: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> }).rows ?? []);

    const first = list[0] ?? {};
    return {
      averageMs: toNumberOrNull(first['avg_ms'] as number | string | null | undefined),
      p50Ms: toNumberOrNull(first['p50_ms'] as number | string | null | undefined),
      p95Ms: toNumberOrNull(first['p95_ms'] as number | string | null | undefined),
    };
  }

  async aggregateExperiment(experimentId: string): Promise<ClassificationAggregateRow[]> {
    const rows = await this.db.execute<{
      decision_output: string | null;
      expected_output: string | null;
      judgment_status: string | null;
      status: string;
      count: number | string;
      input_tokens: number | string | null;
      output_tokens: number | string | null;
      cost_estimate: number | string | null;
    }>(sql`
      SELECT
        decision_output,
        expected_output,
        judgment_status,
        status,
        COUNT(*)::int AS count,
        COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
        COALESCE(SUM(cost_estimate), 0)::numeric AS cost_estimate
      FROM ph_runs.run_results
      WHERE source = 'experiment' AND source_id = ${experimentId}::uuid
      GROUP BY decision_output, expected_output, judgment_status, status
    `);

    const list: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> }).rows ?? []);

    return list.map((row) => ({
      decisionOutput: (row['decision_output'] as string | null) ?? null,
      expectedOutput: (row['expected_output'] as string | null) ?? null,
      judgmentStatus: (row['judgment_status'] as JudgmentStatus | null) ?? null,
      status: row['status'] as RunStatus,
      count: Number(row['count'] ?? 0),
      inputTokens: Number(row['input_tokens'] ?? 0),
      outputTokens: Number(row['output_tokens'] ?? 0),
      costEstimate: Number(row['cost_estimate'] ?? 0),
    }));
  }

  async countBatchTerminal(experimentId: string, runResultIds: string[]): Promise<BatchTerminalCounts> {
    if (runResultIds.length === 0) return { terminalCount: 0, failedCount: 0 };
    const ids = sql.join(
      runResultIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await this.db.execute<{
      terminal_count: number | string;
      failed_count: number | string;
    }>(sql`
      SELECT
        COUNT(*)::int AS terminal_count,
        COUNT(*) FILTER (WHERE ${runResultFailureSql()})::int AS failed_count
      FROM ph_runs.run_results
      WHERE source = 'experiment'
        AND source_id = ${experimentId}::uuid
        AND id IN (${ids})
    `);

    const list: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> }).rows ?? []);

    const first = list[0] ?? {};
    return {
      terminalCount: Number(first['terminal_count'] ?? 0),
      failedCount: Number(first['failed_count'] ?? 0),
    };
  }

  async findBatchTerminalIds(experimentId: string, runResultIds: string[]): Promise<string[]> {
    if (runResultIds.length === 0) return [];
    const ids = sql.join(
      runResultIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id::text AS id
      FROM ph_runs.run_results
      WHERE source = 'experiment'
        AND source_id = ${experimentId}::uuid
        AND id IN (${ids})
    `);

    const list: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> }).rows ?? []);

    return list.map((row) => String(row['id']));
  }

  async findAccessibleExperiment(
    projectId: string,
    experimentId: string,
    _userId: string,
    _isSuperAdmin: boolean,
  ): Promise<ExperimentAccessRow | null> {
    const rows = await this.db.execute<{
      experiment_id: string;
      project_id: string;
    }>(sql`
      SELECT
        e.id AS experiment_id,
        e.project_id
      FROM ph_runs.experiments e
      WHERE e.id = ${experimentId}::uuid
        AND e.project_id = ${projectId}::uuid
        AND e.deleted_at IS NULL
      LIMIT 1
    `);

    const list: Array<Record<string, unknown>> = Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>)
      : ((rows as { rows?: Array<Record<string, unknown>> }).rows ?? []);

    const first = list[0];
    if (!first) return null;
    return {
      experimentId: first['experiment_id'] as string,
      projectId: first['project_id'] as string,
    };
  }

  async listByExperiment(experimentId: string, query: RunResultListQueryDto): Promise<RunResultListResponseDto> {
    const conditions: SQL[] = [sql`rr.source = 'experiment'`, sql`rr.source_id = ${experimentId}::uuid`];

    if (query.status && query.status.length > 0) {
      const items = sql.join(
        query.status.map((value: RunResultStatusDto) => sql`${value}`),
        sql`, `,
      );
      conditions.push(sql`rr.status IN (${items})`);
    }

    if (query.judgmentStatus && query.judgmentStatus.length > 0) {
      const items = sql.join(
        query.judgmentStatus.map((value: RunResultJudgmentStatusDto) => sql`${value}`),
        sql`, `,
      );
      conditions.push(sql`rr.judgment_status IN (${items})`);
    }

    if (typeof query.isCorrect === 'boolean') {
      conditions.push(sql`rr.is_correct = ${query.isCorrect}`);
    }

    if (query.search && query.search.length > 0) {
      const pattern = `%${query.search}%`;
      conditions.push(
        sql`(
          rr.external_id ILIKE ${pattern}
          OR ds.external_id ILIKE ${pattern}
          OR ds.data::text ILIKE ${pattern}
          OR ds.index_values::text ILIKE ${pattern}
          OR rr.raw_response ILIKE ${pattern}
          OR rr.input_variables::text ILIKE ${pattern}
          OR rr.decision_output ILIKE ${pattern}
          OR rr.input_preview ILIKE ${pattern}
          OR rr.output_preview ILIKE ${pattern}
          OR rr.expected_output ILIKE ${pattern}
          OR rr.error_message ILIKE ${pattern}
        )`,
      );
    }

    const whereSql = sql.join(conditions, sql` AND `);

    const sortSql =
      query.sort === 'latency_desc'
        ? sql`rr.latency_ms DESC NULLS LAST, rr.created_at DESC`
        : query.sort === 'tokens_desc'
          ? sql`(COALESCE(rr.input_tokens,0) + COALESCE(rr.output_tokens,0)) DESC, rr.created_at DESC`
          : sql`rr.created_at DESC`;

    const offset = (query.page - 1) * query.pageSize;

    const dataRowsResult: unknown = await this.db.execute(sql`
      SELECT
        rr.id,
        rr.project_id,
        rr.source_id,
        rr.sample_id,
        COALESCE(rr.external_id, ds.external_id) AS external_id,
        rr.status,
        rr.judgment_status,
        rr.is_correct,
        rr.decision_output,
        rr.expected_output,
        ds.data AS sample_data,
        ds.index_values AS sample_index_values,
        ds.payload_ref AS sample_payload_ref,
        d.field_schema AS dataset_field_schema,
        rr.input_preview,
        rr.output_preview,
        rr.input_variables,
        rr.raw_response,
        rr.parsed_output,
        rr.payload_ref,
        rr.error_class,
        rr.error_message,
        rr.latency_ms,
        rr.input_tokens,
        rr.output_tokens,
        rr.cost_estimate,
        rr.attempt,
        rr.created_at
      FROM ph_runs.run_results rr
      LEFT JOIN ph_assets.dataset_samples ds ON ds.id = rr.sample_id
      LEFT JOIN ph_runs.experiments e ON e.id = rr.source_id
      LEFT JOIN ph_assets.datasets d ON d.id = e.dataset_id
      WHERE ${whereSql}
      ORDER BY ${sortSql}
      LIMIT ${query.pageSize}
      OFFSET ${offset}
    `);

    const dataList = unwrapRows<RunResultRowShape>(dataRowsResult);

    const totalResult: unknown = await this.db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM ph_runs.run_results rr
      LEFT JOIN ph_assets.dataset_samples ds ON ds.id = rr.sample_id
      LEFT JOIN ph_runs.experiments e ON e.id = rr.source_id
      LEFT JOIN ph_assets.datasets d ON d.id = e.dataset_id
      WHERE ${whereSql}
    `);
    const totalList = unwrapRows<{ total: number | string }>(totalResult);
    const total = Number(totalList[0]?.total ?? 0);

    return {
      data: dataList.map(toListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listByRelease(
    projectId: string,
    query: RunResultReleaseListQueryDto,
  ): Promise<ReleaseRunResultListResponseDto> {
    const whereSql = releaseRunResultWhereSql(projectId, query);

    const sortSql =
      query.sort === 'latency_desc'
        ? sql`rr.latency_ms DESC NULLS LAST, rr.created_at DESC`
        : query.sort === 'tokens_desc'
          ? sql`(COALESCE(rr.input_tokens,0) + COALESCE(rr.output_tokens,0)) DESC, rr.created_at DESC`
          : sql`rr.created_at DESC`;

    const offset = (query.page - 1) * query.pageSize;

    const dataRowsResult: unknown = await this.db.execute(sql`
      SELECT
        rr.id,
        rr.project_id,
        rr.source,
        rr.source_id,
        release_event.id AS release_event_id,
        COALESCE(rr.release_version_id, release_event.release_version_id) AS release_version_id,
        release_version.kind AS release_version_kind,
        release_version.production_version_number AS release_version_production_number,
        release_version.target_production_version_number AS release_version_target_production_number,
        release_version.candidate_number AS release_version_candidate_number,
        rr.external_id,
        release_event.prompt_name AS prompt_name,
        rr.prompt_version_id,
        COALESCE(release_event.prompt_version_number, pv.version_number) AS prompt_version_number,
        rr.model_id,
        COALESCE(
          release_version.model_snapshot->>'name',
          release_event.model_snapshot->>'name',
          model.name
        ) AS model_name,
        COALESCE(
          release_version.model_snapshot->>'providerType',
          release_version.model_snapshot->>'provider',
          release_event.model_snapshot->>'providerType',
          release_event.model_snapshot->>'provider',
          model.provider_type
        ) AS model_provider,
        release_event.lane_type AS lane_type,
        rr.status,
        rr.judgment_status,
        rr.is_correct,
        rr.decision_output,
        rr.input_preview,
        rr.output_preview,
        rr.input_variables,
        rr.raw_response,
        rr.parsed_output,
        rr.payload_ref,
        rr.error_class,
        rr.error_message,
        rr.latency_ms,
        rr.input_tokens,
        rr.output_tokens,
        rr.cost_estimate,
        rr.attempt,
        rr.created_at
      FROM ph_runs.run_results rr
      JOIN ph_releases.release_line_events release_event
        ON release_event.id = rr.source_id
       AND release_event.project_id = rr.project_id
      LEFT JOIN ph_releases.release_versions release_version
        ON release_version.id = COALESCE(rr.release_version_id, release_event.release_version_id)
      LEFT JOIN ph_assets.prompt_versions pv ON pv.id = rr.prompt_version_id
      LEFT JOIN ph_assets.models model ON model.id = rr.model_id
      WHERE ${whereSql}
      ORDER BY ${sortSql}
      LIMIT ${query.pageSize}
      OFFSET ${offset}
    `);

    const totalResult: unknown = await this.db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM ph_runs.run_results rr
      JOIN ph_releases.release_line_events release_event
        ON release_event.id = rr.source_id
       AND release_event.project_id = rr.project_id
      LEFT JOIN ph_releases.release_versions release_version
        ON release_version.id = COALESCE(rr.release_version_id, release_event.release_version_id)
      WHERE ${whereSql}
    `);
    const totalList = unwrapRows<{ total: number | string }>(totalResult);
    const total = Number(totalList[0]?.total ?? 0);

    // Release run_results offload input_variables / rendered_prompt (SPEC 30 §9.4); hydrate the page
    // (bounded by pageSize) so the release list keeps showing input. Pass-through when not offloaded.
    const releaseRows = unwrapRows<ReleaseRunResultRowShape>(dataRowsResult);
    const releaseFields = await this.payloadReader.hydrateMany(
      releaseRows.map((r) => ({
        renderedPrompt: null,
        inputVariables: r.input_variables,
        rawResponse: r.raw_response,
        parsedOutput: r.parsed_output,
        payloadRef: r.payload_ref,
      })),
    );
    releaseRows.forEach((r, i) => {
      const f = releaseFields[i];
      if (!f) return;
      r.input_variables = f.inputVariables;
      r.raw_response = f.rawResponse;
      r.parsed_output = f.parsedOutput;
    });

    return {
      data: releaseRows.map(toReleaseListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listExperimentExportBatch(
    experimentId: string,
    query: RunResultListQueryDto,
    options: { limit: number; cursor?: RunResultExportCursor | null },
  ): Promise<RunResultExportBatch<RunResultDetailDto>> {
    const whereSql = experimentRunResultWhereSql(experimentId, query, options.cursor ?? null);
    const rows = unwrapRows<RunResultDetailRowShape>(
      await this.db.execute(sql`
        SELECT
          rr.id,
          rr.project_id,
          rr.source_id,
          rr.sample_id,
          COALESCE(rr.external_id, ds.external_id) AS external_id,
          rr.status,
          rr.judgment_status,
          rr.is_correct,
          rr.decision_output,
          rr.expected_output,
          ds.data AS sample_data,
          ds.index_values AS sample_index_values,
          ds.payload_ref AS sample_payload_ref,
          d.field_schema AS dataset_field_schema,
          rr.input_preview,
          rr.output_preview,
          rr.error_class,
          rr.error_message,
          rr.latency_ms,
          rr.input_tokens,
          rr.output_tokens,
          rr.cost_estimate,
          rr.attempt,
          rr.created_at,
          to_char(rr.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
          rr.prompt_version_id,
          rr.model_id,
          rr.rendered_prompt,
          rr.input_variables,
          rr.raw_response,
          rr.parsed_output,
          rr.payload_ref,
          rr.dbos_workflow_id,
          rr.bullmq_job_id
        FROM ph_runs.run_results rr
        LEFT JOIN ph_assets.dataset_samples ds ON ds.id = rr.sample_id
        LEFT JOIN ph_runs.experiments e ON e.id = rr.source_id
        LEFT JOIN ph_assets.datasets d ON d.id = e.dataset_id
        WHERE ${whereSql}
        ORDER BY rr.created_at ASC, rr.id ASC
        LIMIT ${options.limit}
      `),
    );

    const fields = await this.payloadReader.hydrateMany(
      rows.map((r) => ({
        renderedPrompt: r.rendered_prompt,
        inputVariables: r.input_variables,
        rawResponse: r.raw_response,
        parsedOutput: r.parsed_output,
        payloadRef: r.payload_ref,
      })),
    );
    rows.forEach((r, i) => {
      const f = fields[i];
      if (!f) return;
      r.rendered_prompt = f.renderedPrompt;
      r.input_variables = f.inputVariables;
      r.raw_response = f.rawResponse;
      r.parsed_output = f.parsedOutput;
    });
    await this.hydrateSampleDataForRows(rows);

    return {
      rows: rows.map(toDetail),
      nextCursor: nextCursorFromRows(rows, options.limit),
    };
  }

  async listReleaseExportBatch(
    projectId: string,
    query: RunResultReleaseListQueryDto,
    options: { limit: number; cursor?: RunResultExportCursor | null },
  ): Promise<RunResultExportBatch<ReleaseRunResultExportItem>> {
    const whereSql = releaseRunResultWhereSql(projectId, query, options.cursor ?? null);
    const rows = unwrapRows<ReleaseRunResultExportRowShape>(
      await this.db.execute(sql`
        SELECT
          rr.id,
          rr.project_id,
          rr.source,
          rr.source_id,
          release_event.id AS release_event_id,
          COALESCE(rr.release_version_id, release_event.release_version_id) AS release_version_id,
          release_version.kind AS release_version_kind,
          release_version.production_version_number AS release_version_production_number,
          release_version.target_production_version_number AS release_version_target_production_number,
          release_version.candidate_number AS release_version_candidate_number,
          rr.external_id,
          release_event.prompt_name AS prompt_name,
          rr.prompt_version_id,
          COALESCE(release_event.prompt_version_number, pv.version_number) AS prompt_version_number,
          rr.model_id,
          COALESCE(
            release_version.model_snapshot->>'name',
            release_event.model_snapshot->>'name',
            model.name
          ) AS model_name,
          COALESCE(
            release_version.model_snapshot->>'providerType',
            release_version.model_snapshot->>'provider',
            release_event.model_snapshot->>'providerType',
            release_event.model_snapshot->>'provider',
            model.provider_type
          ) AS model_provider,
          release_event.lane_type AS lane_type,
          rr.status,
          rr.judgment_status,
          rr.is_correct,
          rr.decision_output,
          rr.input_preview,
          rr.output_preview,
          rr.rendered_prompt,
          rr.input_variables,
          rr.raw_response,
          rr.parsed_output,
          rr.payload_ref,
          rr.error_class,
          rr.error_message,
          rr.latency_ms,
          rr.input_tokens,
          rr.output_tokens,
          rr.cost_estimate,
          rr.attempt,
          rr.created_at,
          to_char(rr.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
        FROM ph_runs.run_results rr
        JOIN ph_releases.release_line_events release_event
          ON release_event.id = rr.source_id
         AND release_event.project_id = rr.project_id
        LEFT JOIN ph_releases.release_versions release_version
          ON release_version.id = COALESCE(rr.release_version_id, release_event.release_version_id)
        LEFT JOIN ph_assets.prompt_versions pv ON pv.id = rr.prompt_version_id
        LEFT JOIN ph_assets.models model ON model.id = rr.model_id
        WHERE ${whereSql}
        ORDER BY rr.created_at ASC, rr.id ASC
        LIMIT ${options.limit}
      `),
    );

    const fields = await this.payloadReader.hydrateMany(
      rows.map((r) => ({
        renderedPrompt: r.rendered_prompt,
        inputVariables: r.input_variables,
        rawResponse: r.raw_response,
        parsedOutput: r.parsed_output,
        payloadRef: r.payload_ref,
      })),
    );
    rows.forEach((r, i) => {
      const f = fields[i];
      if (!f) return;
      r.rendered_prompt = f.renderedPrompt;
      r.input_variables = f.inputVariables;
      r.raw_response = f.rawResponse;
      r.parsed_output = f.parsedOutput;
    });

    return {
      rows: rows.map(toReleaseExportItem),
      nextCursor: nextCursorFromRows(rows, options.limit),
    };
  }

  async previewReleaseCleanup(
    projectId: string,
    filter: ReleaseRunResultCleanupFilterDto,
  ): Promise<ReleaseRunResultCleanupImpactDto> {
    return (await this.describeReleaseCleanup((query) => this.db.execute(query), projectId, filter)).impact;
  }

  async deleteReleaseCleanup(
    projectId: string,
    filter: ReleaseRunResultCleanupFilterDto,
  ): Promise<ReleaseRunResultCleanupDeleteResult> {
    return this.db.transaction((tx) =>
      this.deleteReleaseCleanupWithExecutor((query) => tx.execute(query), projectId, filter),
    );
  }

  async deleteReleaseRetentionCleanupBatch(now: Date, limit = 50): Promise<ReleaseRunResultRetentionCleanupBatch> {
    return this.db.transaction(async (tx) => {
      const lockRows = unwrapRows<{ acquired: boolean }>(
        await tx.execute(sql`SELECT pg_try_advisory_xact_lock(22030, 30) AS acquired`),
      );
      if (lockRows[0]?.acquired !== true) {
        return { lockAcquired: false, targets: 0, cleanups: [] };
      }

      const execute = (query: SQL) => tx.execute(query);
      const targets = await this.listReleaseRetentionCleanupTargets(now, limit, execute);
      const cleanups: ReleaseRunResultRetentionCleanup[] = [];

      for (const target of targets) {
        const { payloadRefs, ...impact } = await this.deleteReleaseCleanupWithExecutor(execute, target.projectId, {
          sourceIds: [target.sourceId],
          releaseVersionScope: 'exact',
          to: target.cutoff,
        });
        cleanups.push({ target, impact, payloadRefs });
      }

      return { lockAcquired: true, targets: targets.length, cleanups };
    });
  }

  async listReleaseRetentionCleanupTargets(
    now: Date,
    limit = 50,
    execute: (query: SQL) => Promise<unknown> = (query) => this.db.execute(query),
  ): Promise<ReleaseRunResultRetentionTarget[]> {
    const rows = unwrapRows<{
      project_id: string;
      source_id: string;
      retention_days: number | string;
      cutoff: string | Date;
    }>(
      await execute(sql`
        SELECT
          event.project_id,
          event.id AS source_id,
          event.retention_days,
          (${now.toISOString()}::timestamptz - make_interval(days => event.retention_days)) AS cutoff
        FROM ph_releases.release_line_events event
        WHERE event.retention_days IS NOT NULL
          AND event.retention_days > 0
          AND EXISTS (
            SELECT 1
            FROM ph_runs.run_results rr
            WHERE rr.project_id = event.project_id
              AND rr.source = 'release'
              AND rr.source_id = event.id
              AND rr.created_at < (${now.toISOString()}::timestamptz - make_interval(days => event.retention_days))
          )
        ORDER BY event.project_id ASC, event.id ASC
        LIMIT ${limit}
      `),
    );

    return rows.map((row) => ({
      projectId: row.project_id,
      sourceId: row.source_id,
      retentionDays: Number(row.retention_days),
      cutoff: toIsoString(row.cutoff),
    }));
  }

  private async deleteReleaseCleanupWithExecutor(
    execute: (query: SQL) => Promise<unknown>,
    projectId: string,
    filter: ReleaseRunResultCleanupFilterDto,
  ): Promise<ReleaseRunResultCleanupDeleteResult> {
    const { impact, reclaimablePayloadRefs } = await this.describeReleaseCleanup(execute, projectId, filter);

    if (impact.runResults === 0) {
      return { ...impact, payloadRefs: [] };
    }

    const whereSql = releaseRunResultWhereSql(projectId, filter);
    await execute(sql`
      WITH target_run_results AS (
        SELECT rr.id, rr.created_at
        FROM ph_runs.run_results rr
        JOIN ph_releases.release_line_events release_event
          ON release_event.id = rr.source_id
         AND release_event.project_id = rr.project_id
        LEFT JOIN ph_releases.release_versions release_version
          ON release_version.id = COALESCE(rr.release_version_id, release_event.release_version_id)
        WHERE ${whereSql}
      )
      DELETE FROM ph_runs.annotations annotation
      USING target_run_results target
      WHERE annotation.run_result_id = target.id
        AND annotation.run_result_created_at = target.created_at
    `);

    await execute(sql`
      WITH target_run_results AS (
        SELECT rr.id, rr.created_at
        FROM ph_runs.run_results rr
        JOIN ph_releases.release_line_events release_event
          ON release_event.id = rr.source_id
         AND release_event.project_id = rr.project_id
        LEFT JOIN ph_releases.release_versions release_version
          ON release_version.id = COALESCE(rr.release_version_id, release_event.release_version_id)
        WHERE ${whereSql}
      )
      DELETE FROM ph_runs.run_results rr
      USING target_run_results target
      WHERE rr.id = target.id
        AND rr.created_at = target.created_at
    `);

    return { ...impact, payloadRefs: reclaimablePayloadRefs };
  }

  private async describeReleaseCleanup(
    execute: (query: SQL) => Promise<unknown>,
    projectId: string,
    filter: ReleaseRunResultCleanupFilterDto,
  ): Promise<{ impact: ReleaseRunResultCleanupImpactDto; reclaimablePayloadRefs: StoredObjectRef[] }> {
    const whereSql = releaseRunResultWhereSql(projectId, filter);
    const impactRows = unwrapRows<{
      run_results: number | string;
      annotations: number | string;
      run_result_row_bytes: number | string | null;
      annotation_bytes: number | string | null;
    }>(
      await execute(sql`
        WITH target_run_results AS (
          SELECT
            rr.id,
            rr.created_at,
            pg_column_size(to_jsonb(rr))::bigint AS row_bytes
          FROM ph_runs.run_results rr
          JOIN ph_releases.release_line_events release_event
            ON release_event.id = rr.source_id
           AND release_event.project_id = rr.project_id
          LEFT JOIN ph_releases.release_versions release_version
            ON release_version.id = COALESCE(rr.release_version_id, release_event.release_version_id)
          WHERE ${whereSql}
        ),
        target_annotations AS (
          SELECT pg_column_size(to_jsonb(annotation))::bigint AS row_bytes
          FROM ph_runs.annotations annotation
          JOIN target_run_results target
            ON annotation.run_result_id = target.id
           AND annotation.run_result_created_at = target.created_at
        )
        SELECT
          (SELECT COUNT(*)::int FROM target_run_results) AS run_results,
          (SELECT COUNT(*)::int FROM target_annotations) AS annotations,
          (SELECT COALESCE(SUM(row_bytes), 0)::bigint FROM target_run_results) AS run_result_row_bytes,
          (SELECT COALESCE(SUM(row_bytes), 0)::bigint FROM target_annotations) AS annotation_bytes
      `),
    );

    const allPayloadRows = unwrapRows<{ payload_ref: unknown }>(
      await execute(sql`
        WITH target_run_results AS (
          SELECT rr.payload_ref
          FROM ph_runs.run_results rr
          JOIN ph_releases.release_line_events release_event
            ON release_event.id = rr.source_id
           AND release_event.project_id = rr.project_id
          LEFT JOIN ph_releases.release_versions release_version
            ON release_version.id = COALESCE(rr.release_version_id, release_event.release_version_id)
          WHERE ${whereSql}
        )
        SELECT payload_ref
        FROM target_run_results
        WHERE payload_ref IS NOT NULL
      `),
    );

    const reclaimablePayloadRows = unwrapRows<{ payload_ref: unknown }>(
      await execute(sql`
        WITH target_run_results AS (
          SELECT rr.id, rr.created_at, rr.payload_ref
          FROM ph_runs.run_results rr
          JOIN ph_releases.release_line_events release_event
            ON release_event.id = rr.source_id
           AND release_event.project_id = rr.project_id
          LEFT JOIN ph_releases.release_versions release_version
            ON release_version.id = COALESCE(rr.release_version_id, release_event.release_version_id)
          WHERE ${whereSql}
        )
        SELECT DISTINCT target.payload_ref
        FROM target_run_results target
        WHERE target.payload_ref IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM ph_runs.run_results other
            WHERE other.payload_ref IS NOT NULL
              AND COALESCE(other.payload_ref->'shard'->>'key', other.payload_ref->>'key')
                = COALESCE(target.payload_ref->'shard'->>'key', target.payload_ref->>'key')
              AND NOT EXISTS (
                SELECT 1
                FROM target_run_results same_target
                WHERE same_target.id = other.id
                  AND same_target.created_at = other.created_at
              )
          )
      `),
    );

    const first = impactRows[0] ?? {
      run_results: 0,
      annotations: 0,
      run_result_row_bytes: 0,
      annotation_bytes: 0,
    };
    const runResultRowBytes = nonnegativeInteger(first.run_result_row_bytes);
    const annotationBytes = nonnegativeInteger(first.annotation_bytes);
    const dbBytes = runResultRowBytes + annotationBytes;
    const allPayloadRefs = collectStoredObjectRefs(allPayloadRows.map((row) => row.payload_ref));
    const reclaimablePayloadRefs = collectStoredObjectRefs(reclaimablePayloadRows.map((row) => row.payload_ref));
    const objectBytes = sumStoredObjectBytes(allPayloadRefs);
    const reclaimableObjectBytes = sumStoredObjectBytes(reclaimablePayloadRefs);
    const deferredObjectBytes = Math.max(0, objectBytes - reclaimableObjectBytes);

    return {
      impact: {
        runResults: nonnegativeInteger(first.run_results),
        annotations: nonnegativeInteger(first.annotations),
        runResultRowBytes,
        annotationBytes,
        dbBytes,
        objectBytes,
        reclaimableObjectBytes,
        deferredObjectBytes,
        estimatedMatchedBytes: dbBytes + objectBytes,
        estimatedReclaimableBytes: dbBytes + reclaimableObjectBytes,
      },
      reclaimablePayloadRefs,
    };
  }

  async getDetailById(experimentId: string, runResultId: string): Promise<RunResultDetailDto | null> {
    const rows: unknown = await this.db.execute(sql`
      SELECT
        rr.id,
        rr.project_id,
        rr.source_id,
        rr.sample_id,
        COALESCE(rr.external_id, ds.external_id) AS external_id,
        rr.status,
        rr.judgment_status,
        rr.is_correct,
        rr.decision_output,
        rr.expected_output,
        ds.data AS sample_data,
        ds.index_values AS sample_index_values,
        ds.payload_ref AS sample_payload_ref,
        d.field_schema AS dataset_field_schema,
        rr.error_class,
        rr.error_message,
        rr.latency_ms,
        rr.input_tokens,
        rr.output_tokens,
        rr.cost_estimate,
        rr.attempt,
        rr.created_at,
        rr.prompt_version_id,
        rr.model_id,
        rr.rendered_prompt,
        rr.input_variables,
        rr.raw_response,
        rr.parsed_output,
        rr.payload_ref,
        rr.dbos_workflow_id,
        rr.bullmq_job_id
      FROM ph_runs.run_results rr
      LEFT JOIN ph_assets.dataset_samples ds ON ds.id = rr.sample_id
      LEFT JOIN ph_runs.experiments e ON e.id = rr.source_id
      LEFT JOIN ph_assets.datasets d ON d.id = e.dataset_id
      WHERE rr.source = 'experiment'
        AND rr.source_id = ${experimentId}::uuid
        AND rr.id = ${runResultId}::uuid
      ORDER BY rr.created_at DESC
      LIMIT 1
    `);

    const list = unwrapRows<RunResultDetailRowShape>(rows);
    const first = list[0];
    if (!first) return null;
    // Resolve the large fields through the seam: inline when present, else read the offload shard
    // (SPEC 30 §9.2). A no-op pass-through when the row was never compacted / storage is disabled.
    const [fields, sampleData] = await Promise.all([
      this.payloadReader.hydrate({
        renderedPrompt: first.rendered_prompt,
        inputVariables: first.input_variables,
        rawResponse: first.raw_response,
        parsedOutput: first.parsed_output,
        payloadRef: first.payload_ref,
      }),
      this.samplePayloadReader.hydrate({
        data: first.sample_data,
        payloadRef: first.sample_payload_ref,
      }),
    ]);
    return toDetail({
      ...first,
      sample_data: sampleData ?? first.sample_data,
      rendered_prompt: fields.renderedPrompt,
      input_variables: fields.inputVariables,
      raw_response: fields.rawResponse,
      parsed_output: fields.parsedOutput,
    });
  }

  private async hydrateSampleDataForRows(rows: RunResultDetailRowShape[]): Promise<void> {
    const hydrated = await this.samplePayloadReader.hydrateMany(
      rows.map((row) => ({
        data: row.sample_data,
        payloadRef: row.sample_payload_ref,
      })),
    );
    rows.forEach((row, index) => {
      const data = hydrated[index];
      if (data !== null && data !== undefined) row.sample_data = data;
    });
  }
}

interface RunResultRowShape {
  id: string;
  project_id: string;
  source_id: string;
  sample_id: string | null;
  external_id: string | null;
  status: string;
  judgment_status: string | null;
  is_correct: boolean | null;
  decision_output: string | null;
  expected_output: string | null;
  sample_data: unknown;
  sample_index_values: unknown;
  sample_payload_ref: DatasetSamplePayloadRef | null;
  dataset_field_schema: unknown;
  input_preview: string | null;
  output_preview: string | null;
  input_variables: unknown;
  raw_response: string | null;
  parsed_output: unknown;
  payload_ref: RunResultPayloadRef | null;
  error_class: string | null;
  error_message: string | null;
  latency_ms: number | string | null;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  cost_estimate: number | string | null;
  attempt: number | string;
  created_at: string | Date;
  cursor_created_at?: string;
}

interface RunResultDetailRowShape extends RunResultRowShape {
  prompt_version_id: string;
  model_id: string;
  rendered_prompt: unknown;
  input_variables: unknown;
  raw_response: string | null;
  parsed_output: unknown;
  payload_ref: RunResultPayloadRef | null;
  dbos_workflow_id: string | null;
  bullmq_job_id: string | null;
}

interface ReleaseRunResultRowShape {
  id: string;
  project_id: string;
  source: 'release';
  source_id: string;
  release_event_id: string | null;
  release_version_id: string | null;
  release_version_kind: 'candidate' | 'production' | null;
  release_version_production_number: number | string | null;
  release_version_target_production_number: number | string | null;
  release_version_candidate_number: number | string | null;
  lane_type: ReleaseRunResultLaneDto;
  external_id: string | null;
  prompt_name: string | null;
  prompt_version_id: string;
  prompt_version_number: number | string | null;
  model_id: string;
  model_name: string | null;
  model_provider: string | null;
  status: string;
  judgment_status: string | null;
  is_correct: boolean | null;
  decision_output: string | null;
  input_variables: unknown;
  raw_response: string | null;
  parsed_output: unknown;
  payload_ref: RunResultPayloadRef | null;
  error_class: string | null;
  error_message: string | null;
  latency_ms: number | string | null;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  cost_estimate: number | string | null;
  attempt: number | string;
  created_at: string | Date;
  cursor_created_at?: string;
}

interface ReleaseRunResultExportRowShape extends ReleaseRunResultRowShape {
  rendered_prompt: unknown;
}

const TEXT_FIELD_ROLES = new Set<DatasetFieldSchemaRole>(['text']);
const IMAGE_FIELD_ROLES = new Set<DatasetFieldSchemaRole>(['image', 'image_url', 'image_base64']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getDatasetFieldValues(
  fieldSchema: unknown,
  sampleData: unknown,
  sampleIndexValues: unknown,
  inputVariables: unknown,
  roles: Set<DatasetFieldSchemaRole>,
): RunResultDatasetFieldValueDto[] {
  const data = isRecord(sampleData) ? sampleData : {};
  const indexValues = isRecord(sampleIndexValues) ? sampleIndexValues : {};
  const inputs = isRecord(inputVariables) ? inputVariables : {};
  const fields = Array.isArray(fieldSchema) ? fieldSchema : [];
  const out: RunResultDatasetFieldValueDto[] = [];

  for (const field of fields) {
    if (!isRecord(field)) continue;
    const name = field['name'];
    const role = field['role'];
    if (typeof name !== 'string' || typeof role !== 'string') continue;
    if (!roles.has(role as DatasetFieldSchemaRole)) continue;
    const value = Object.prototype.hasOwnProperty.call(data, name)
      ? (data[name] ?? null)
      : Object.prototype.hasOwnProperty.call(indexValues, name)
        ? (indexValues[name] ?? null)
        : Object.prototype.hasOwnProperty.call(inputs, name)
          ? (inputs[name] ?? null)
          : null;
    out.push({
      name,
      role: role as DatasetFieldSchemaRole,
      value,
    });
  }

  return out;
}

function unwrapRows<T = unknown>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
    const inner = (result as { rows?: T[] }).rows;
    return inner ?? [];
  }
  return [];
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nextCursorFromRows<T extends { id: string; created_at: string | Date; cursor_created_at?: string }>(
  rows: T[],
  limit: number,
): RunResultExportCursor | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  if (!last) return null;
  return {
    id: last.id,
    createdAt: last.cursor_created_at ?? toIsoString(last.created_at),
  };
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function nonnegativeInteger(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

function runResultFailureSql(): SQL {
  return sql`
    status = 'failed'
    OR judgment_status = 'parse_error'
    OR (judgment_status = 'judge_error' AND expected_output IS NOT NULL)
  `;
}

function uuidList(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

function stringList(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

interface ReleaseRunResultFilter {
  sourceIds?: readonly string[];
  releaseVersionIds?: readonly string[];
  releaseVersionScope?: 'exact' | 'journey';
  promptVersionIds?: readonly string[];
  lane?: readonly string[];
  status?: readonly string[];
  judgmentStatus?: readonly string[];
  isCorrect?: boolean;
  externalId?: string;
  from?: string;
  to?: string;
  search?: string;
}

function experimentRunResultWhereSql(
  experimentId: string,
  query: RunResultListQueryDto,
  cursor?: RunResultExportCursor | null,
): SQL {
  const conditions: SQL[] = [sql`rr.source = 'experiment'`, sql`rr.source_id = ${experimentId}::uuid`];

  if (query.status && query.status.length > 0) {
    conditions.push(sql`rr.status IN (${stringList(query.status)})`);
  }

  if (query.judgmentStatus && query.judgmentStatus.length > 0) {
    conditions.push(sql`rr.judgment_status IN (${stringList(query.judgmentStatus)})`);
  }

  if (typeof query.isCorrect === 'boolean') {
    conditions.push(sql`rr.is_correct = ${query.isCorrect}`);
  }

  if (query.search && query.search.length > 0) {
    const pattern = `%${query.search}%`;
    conditions.push(
      sql`(
        rr.external_id ILIKE ${pattern}
        OR ds.external_id ILIKE ${pattern}
        OR ds.data::text ILIKE ${pattern}
        OR ds.index_values::text ILIKE ${pattern}
        OR rr.raw_response ILIKE ${pattern}
        OR rr.input_variables::text ILIKE ${pattern}
        OR rr.decision_output ILIKE ${pattern}
        OR rr.input_preview ILIKE ${pattern}
        OR rr.output_preview ILIKE ${pattern}
        OR rr.expected_output ILIKE ${pattern}
        OR rr.error_message ILIKE ${pattern}
      )`,
    );
  }

  if (cursor) {
    conditions.push(sql`(rr.created_at, rr.id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`);
  }

  return sql.join(conditions, sql` AND `);
}

function releaseRunResultWhereSql(
  projectId: string,
  query: ReleaseRunResultFilter,
  cursor?: RunResultExportCursor | null,
): SQL {
  const conditions: SQL[] = [sql`rr.project_id = ${projectId}::uuid`, sql`rr.source = 'release'`];

  if (query.sourceIds && query.sourceIds.length > 0) {
    conditions.push(sql`rr.source_id IN (${uuidList(query.sourceIds)})`);
  }

  if (query.releaseVersionIds && query.releaseVersionIds.length > 0) {
    conditions.push(releaseVersionConditionSql(query.releaseVersionIds, query.releaseVersionScope ?? 'exact'));
  }

  if (query.promptVersionIds && query.promptVersionIds.length > 0) {
    conditions.push(sql`rr.prompt_version_id IN (${uuidList(query.promptVersionIds)})`);
  }

  if (query.lane && query.lane.length > 0) {
    conditions.push(sql`release_event.lane_type IN (${stringList(query.lane)})`);
  }

  if (query.status && query.status.length > 0) {
    conditions.push(sql`rr.status IN (${stringList(query.status)})`);
  }

  if (query.judgmentStatus && query.judgmentStatus.length > 0) {
    conditions.push(sql`rr.judgment_status IN (${stringList(query.judgmentStatus)})`);
  }

  if (typeof query.isCorrect === 'boolean') {
    conditions.push(sql`rr.is_correct = ${query.isCorrect}`);
  }

  if (query.externalId && query.externalId.length > 0) {
    conditions.push(sql`rr.external_id ILIKE ${`%${query.externalId}%`}`);
  }

  if (query.from) {
    conditions.push(sql`rr.created_at >= ${query.from}::timestamptz`);
  }

  if (query.to) {
    conditions.push(sql`rr.created_at < ${query.to}::timestamptz`);
  }

  if (query.search && query.search.length > 0) {
    const pattern = `%${query.search}%`;
    conditions.push(
      sql`(
        rr.external_id ILIKE ${pattern}
        OR rr.source_id::text ILIKE ${pattern}
        OR COALESCE(rr.release_version_id, release_event.release_version_id)::text ILIKE ${pattern}
        OR release_event.prompt_name ILIKE ${pattern}
        OR COALESCE(release_version.model_snapshot->>'name', release_event.model_snapshot->>'name') ILIKE ${pattern}
        OR rr.raw_response ILIKE ${pattern}
        OR rr.input_variables::text ILIKE ${pattern}
        OR rr.decision_output ILIKE ${pattern}
        OR rr.input_preview ILIKE ${pattern}
        OR rr.output_preview ILIKE ${pattern}
        OR rr.expected_output ILIKE ${pattern}
        OR rr.error_message ILIKE ${pattern}
      )`,
    );
  }

  if (cursor) {
    conditions.push(sql`(rr.created_at, rr.id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`);
  }

  return sql.join(conditions, sql` AND `);
}

function releaseVersionConditionSql(ids: readonly string[], scope: 'exact' | 'journey'): SQL {
  const currentVersionId = sql`COALESCE(rr.release_version_id, release_event.release_version_id)`;
  if (scope === 'exact') return sql`${currentVersionId} IN (${uuidList(ids)})`;
  return sql`release_version.target_production_version_number IN (
    SELECT selected.target_production_version_number
    FROM ph_releases.release_versions selected
    WHERE selected.id IN (${uuidList(ids)})
  )`;
}

function formatReleaseVersionLabel(
  kind: 'candidate' | 'production' | null,
  productionNumber: number | null,
  targetProductionNumber: number | null,
  candidateNumber: number | null,
): string | null {
  if (!kind || !targetProductionNumber) return null;
  if (kind === 'production') return `v${productionNumber ?? targetProductionNumber}`;
  return `v${Math.max(0, targetProductionNumber - 1)}.${candidateNumber ?? 0}`;
}

const PREVIEW_MAX = 1000;
function previewOfValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length === 0) return null;
  return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) : text;
}

function toListItem(row: RunResultRowShape): RunResultListItemDto {
  return {
    id: row.id,
    projectId: row.project_id,
    experimentId: row.source_id,
    sampleId: row.sample_id,
    externalId: row.external_id,
    status: row.status as RunResultListItemDto['status'],
    judgmentStatus: (row.judgment_status as RunResultListItemDto['judgmentStatus']) ?? null,
    isCorrect: row.is_correct,
    decisionOutput: row.decision_output,
    expectedOutput: row.expected_output,
    datasetTextFields: getDatasetFieldValues(
      row.dataset_field_schema,
      row.sample_data,
      row.sample_index_values,
      row.input_variables,
      TEXT_FIELD_ROLES,
    ),
    datasetImageFields: getDatasetFieldValues(
      row.dataset_field_schema,
      row.sample_data,
      row.sample_index_values,
      row.input_variables,
      IMAGE_FIELD_ROLES,
    ),
    // List previews come from the persisted preview columns once compacted, else are computed from the
    // still-inline fields (SPEC 30 §9). The full fields below are null after compaction (detail rehydrates).
    inputPreview: row.input_preview ?? previewOfValue(row.input_variables),
    outputPreview: row.output_preview ?? row.decision_output ?? previewOfValue(row.parsed_output) ?? row.raw_response,
    inputVariables: row.input_variables ?? null,
    rawResponse: row.raw_response,
    parsedOutput: row.parsed_output ?? null,
    errorClass: row.error_class,
    errorMessage: row.error_message,
    latencyMs: toNumberOrNull(row.latency_ms),
    inputTokens: toNumberOrNull(row.input_tokens),
    outputTokens: toNumberOrNull(row.output_tokens),
    costEstimate: toNumberOrNull(row.cost_estimate),
    attempt: Number(row.attempt),
    createdAt: toIsoString(row.created_at),
  };
}

function toReleaseListItem(row: ReleaseRunResultRowShape): ReleaseRunResultListItemDto {
  const lane = row.lane_type;
  const targetProductionNumber = toNumberOrNull(row.release_version_target_production_number);
  const candidateNumber = toNumberOrNull(row.release_version_candidate_number);
  const productionNumber = toNumberOrNull(row.release_version_production_number);
  return {
    id: row.id,
    projectId: row.project_id,
    source: row.source,
    sourceId: row.source_id,
    lane,
    eventId: row.release_event_id ?? row.source_id,
    canaryId: lane === 'canary' ? (row.release_event_id ?? row.source_id) : null,
    releaseVersionId: row.release_version_id ?? null,
    releaseVersionKind: row.release_version_kind ?? null,
    releaseVersionLabel: formatReleaseVersionLabel(
      row.release_version_kind,
      productionNumber,
      targetProductionNumber,
      candidateNumber,
    ),
    releaseVersionProductionNumber: productionNumber,
    releaseVersionTargetProductionNumber: targetProductionNumber,
    releaseVersionCandidateNumber: candidateNumber,
    externalId: row.external_id,
    promptName: row.prompt_name ?? null,
    promptVersionId: row.prompt_version_id,
    promptVersionNumber: toNumberOrNull(row.prompt_version_number),
    modelId: row.model_id,
    modelName: row.model_name ?? null,
    modelProvider: row.model_provider ?? null,
    status: row.status as ReleaseRunResultListItemDto['status'],
    judgmentStatus: (row.judgment_status as ReleaseRunResultListItemDto['judgmentStatus']) ?? null,
    isCorrect: row.is_correct,
    decisionOutput: row.decision_output,
    inputVariables: row.input_variables ?? null,
    rawResponse: row.raw_response,
    parsedOutput: row.parsed_output ?? null,
    errorClass: row.error_class,
    errorMessage: row.error_message,
    latencyMs: toNumberOrNull(row.latency_ms),
    inputTokens: toNumberOrNull(row.input_tokens),
    outputTokens: toNumberOrNull(row.output_tokens),
    costEstimate: toNumberOrNull(row.cost_estimate),
    attempt: Number(row.attempt),
    createdAt: toIsoString(row.created_at),
  };
}

function toReleaseExportItem(row: ReleaseRunResultExportRowShape): ReleaseRunResultExportItem {
  return {
    ...toReleaseListItem(row),
    renderedPrompt: row.rendered_prompt ?? null,
  };
}

function toDetail(row: RunResultDetailRowShape): RunResultDetailDto {
  return {
    ...toListItem(row),
    source: 'experiment',
    promptVersionId: row.prompt_version_id,
    modelId: row.model_id,
    renderedPrompt: row.rendered_prompt ?? null,
    inputVariables: row.input_variables ?? null,
    rawResponse: row.raw_response,
    parsedOutput: row.parsed_output ?? null,
    dbosWorkflowId: row.dbos_workflow_id,
    bullmqJobId: row.bullmq_job_id,
  };
}
