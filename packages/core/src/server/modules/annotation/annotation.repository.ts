import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '@proofhound/db';
import {
  deriveClassificationOptionsFromAnnotationSchema,
  deriveClassificationOptionsFromPromptVersionSnapshot,
} from '@proofhound/shared';
import type {
  AnnotationReleaseLineOptionDto,
  AnnotationSampleDto,
  AnnotationSampleStatusDto,
  AnnotationTaskDto,
  AnnotationTaskScopeDto,
  CreateAnnotationTaskInputDto,
} from '@proofhound/shared';
import { sql, type SQL } from 'drizzle-orm';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

@Injectable()
export class AnnotationRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  async findProject(projectId: string): Promise<{ id: string } | null> {
    const rows = await this.db.execute(sql`
      SELECT id
      FROM ph_core.projects
      WHERE id = ${projectId}::uuid
        AND deleted_at IS NULL
      LIMIT 1
    `);
    return unwrapRows<{ id: string }>(rows)[0] ?? null;
  }

  async listOptions(projectId: string): Promise<AnnotationReleaseLineOptionDto[]> {
    const rows = await this.db.execute(sql`
      SELECT
        line.id AS release_line_id,
        line.name AS release_line_name,
        line.status AS release_line_status,
        line.prompt_name AS prompt_name,
        line.input_connector_name AS input_connector_name,
        version.id AS release_version_id,
        version.kind AS release_version_kind,
        version.production_version_number,
        version.target_production_version_number,
        version.candidate_number,
        version.prompt_version_id,
        version.prompt_version_number,
        version.prompt_version_snapshot,
        COALESCE(version.model_snapshot->>'name', model.name) AS model_name,
        COALESCE(
          version.model_snapshot->>'providerType',
          version.model_snapshot->>'provider',
          model.provider_type
        ) AS model_provider,
        version.model_id,
        COUNT(rr.id)::int AS run_result_count,
        COUNT(rr.id) FILTER (WHERE event.lane_type = 'canary')::int AS canary_count,
        COUNT(rr.id) FILTER (WHERE event.lane_type = 'production')::int AS online_count,
        (
          SELECT COALESCE(jsonb_object_agg(category_counts.category, category_counts.total), '{}'::jsonb)
          FROM (
            SELECT category_rr.decision_output AS category, COUNT(*)::int AS total
            FROM ph_runs.run_results category_rr
            INNER JOIN ph_releases.release_line_events category_event
              ON category_event.id = category_rr.source_id
             AND category_event.project_id = category_rr.project_id
            INNER JOIN ph_releases.release_versions category_version
              ON category_version.id = COALESCE(category_rr.release_version_id, category_event.release_version_id)
            WHERE category_rr.project_id = line.project_id
              AND category_rr.source = 'release'
              AND category_event.release_line_id = line.id
              AND category_version.id = version.id
              AND category_rr.decision_output IS NOT NULL
            GROUP BY category_rr.decision_output
          ) category_counts
        ) AS category_counts,
        (
          SELECT COUNT(*)::int
          FROM ph_runs.run_results journey_rr
          INNER JOIN ph_releases.release_line_events journey_event
            ON journey_event.id = journey_rr.source_id
           AND journey_event.project_id = journey_rr.project_id
          INNER JOIN ph_releases.release_versions journey_version
            ON journey_version.id = COALESCE(journey_rr.release_version_id, journey_event.release_version_id)
          WHERE journey_rr.project_id = line.project_id
            AND journey_rr.source = 'release'
            AND journey_event.release_line_id = line.id
            AND journey_event.lane_type = 'canary'
            AND journey_version.target_production_version_number = version.target_production_version_number
        ) AS journey_canary_count,
        (
          SELECT COUNT(*)::int
          FROM ph_runs.run_results journey_rr
          INNER JOIN ph_releases.release_line_events journey_event
            ON journey_event.id = journey_rr.source_id
           AND journey_event.project_id = journey_rr.project_id
          INNER JOIN ph_releases.release_versions journey_version
            ON journey_version.id = COALESCE(journey_rr.release_version_id, journey_event.release_version_id)
          WHERE journey_rr.project_id = line.project_id
            AND journey_rr.source = 'release'
            AND journey_event.release_line_id = line.id
            AND journey_event.lane_type = 'production'
            AND journey_version.target_production_version_number = version.target_production_version_number
        ) AS journey_online_count
      FROM ph_releases.release_lines line
      INNER JOIN ph_releases.release_versions version
        ON version.release_line_id = line.id
       AND version.project_id = line.project_id
      LEFT JOIN ph_assets.models model ON model.id = version.model_id
      LEFT JOIN ph_releases.release_line_events event
        ON event.release_line_id = line.id
       AND event.release_version_id = version.id
       AND event.project_id = line.project_id
      LEFT JOIN ph_runs.run_results rr
        ON rr.source = 'release'
       AND rr.source_id = event.id
       AND rr.project_id = line.project_id
      WHERE line.project_id = ${projectId}::uuid
        AND line.status <> 'archived'
      GROUP BY
        line.id,
        line.name,
        line.status,
        line.prompt_name,
        line.input_connector_name,
        version.id,
        version.kind,
        version.production_version_number,
        version.target_production_version_number,
        version.candidate_number,
        version.prompt_version_id,
        version.prompt_version_number,
        version.prompt_version_snapshot,
        version.model_id,
        version.model_snapshot,
        model.name,
        model.provider_type
      ORDER BY line.updated_at DESC, version.target_production_version_number ASC, version.kind DESC, version.candidate_number ASC
    `);

    const byLine = new Map<string, AnnotationReleaseLineOptionDto>();
    for (const row of unwrapRows<Record<string, unknown>>(rows)) {
      const lineId = row['release_line_id'] as string;
      const line = byLine.get(lineId) ?? {
        id: lineId,
        name: String(row['release_line_name'] ?? ''),
        status: String(row['release_line_status'] ?? ''),
        promptName: String(row['prompt_name'] ?? ''),
        inputConnectorName: (row['input_connector_name'] as string | null) ?? null,
        versions: [],
      };
      const categoryOptions = deriveClassificationOptionsFromPromptVersionSnapshot(row['prompt_version_snapshot']);
      line.versions.push({
        id: row['release_version_id'] as string,
        releaseLineId: lineId,
        label: formatReleaseVersionLabel(row),
        kind: row['release_version_kind'] as 'candidate' | 'production',
        productionVersionNumber: toNumberOrNull(row['production_version_number'] as number | string | null),
        targetProductionVersionNumber: Number(row['target_production_version_number'] ?? 1),
        candidateNumber: toNumberOrNull(row['candidate_number'] as number | string | null),
        promptVersionId: row['prompt_version_id'] as string,
        promptVersionNumber: toNumberOrNull(row['prompt_version_number'] as number | string | null),
        promptVersionLabel: formatPromptVersionLabel(row['prompt_version_number'] as number | string | null),
        categoryOptions,
        modelId: row['model_id'] as string,
        modelName: (row['model_name'] as string | null) ?? null,
        modelProvider: (row['model_provider'] as string | null) ?? null,
        runResultCount: Number(row['run_result_count'] ?? 0),
        canaryCount: Number(row['canary_count'] ?? 0),
        onlineCount: Number(row['online_count'] ?? 0),
        journeyCanaryCount: Number(row['journey_canary_count'] ?? 0),
        journeyOnlineCount: Number(row['journey_online_count'] ?? 0),
        journeyCompatible: true,
        categoryCounts: parseCategoryCounts(row['category_counts'], categoryOptions),
      });
      byLine.set(lineId, line);
    }
    for (const line of byLine.values()) {
      const targetCategoryKeys = new Map<number, string | null>();
      for (const version of line.versions) {
        const currentKey = categoryOptionsKey(version.categoryOptions);
        const previousKey = targetCategoryKeys.get(version.targetProductionVersionNumber);
        targetCategoryKeys.set(
          version.targetProductionVersionNumber,
          previousKey === undefined || previousKey === currentKey ? currentKey : null,
        );
      }
      for (const version of line.versions) {
        version.journeyCompatible =
          targetCategoryKeys.get(version.targetProductionVersionNumber) === categoryOptionsKey(version.categoryOptions);
      }
    }
    return Array.from(byLine.values());
  }

  async countMatchingRunResults(
    projectId: string,
    releaseLineId: string,
    releaseVersionId: string,
    releaseVersionScope: 'exact' | 'journey',
    scope: AnnotationTaskScopeDto,
  ): Promise<number> {
    const versionFilter = releaseVersionFilterSql(releaseVersionId, releaseVersionScope);
    const scopeFilter = scopeFilterSql(scope);
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM ph_runs.run_results rr
      INNER JOIN ph_releases.release_line_events event
        ON event.id = rr.source_id
       AND event.project_id = rr.project_id
      LEFT JOIN ph_releases.release_versions version
        ON version.id = COALESCE(rr.release_version_id, event.release_version_id)
      WHERE rr.project_id = ${projectId}::uuid
        AND rr.source = 'release'
        AND event.release_line_id = ${releaseLineId}::uuid
        AND ${scopeFilter}
        AND ${versionFilter}
    `);
    return Number(unwrapRows<Record<string, unknown>>(rows)[0]?.['total'] ?? 0);
  }

  async countMatchingRunResultsByCategory(
    projectId: string,
    releaseLineId: string,
    releaseVersionId: string,
    releaseVersionScope: 'exact' | 'journey',
    scope: AnnotationTaskScopeDto,
  ): Promise<Map<string, number>> {
    const versionFilter = releaseVersionFilterSql(releaseVersionId, releaseVersionScope);
    const scopeFilter = scopeFilterSql(scope);
    const rows = await this.db.execute(sql`
      SELECT rr.decision_output AS category, COUNT(*)::int AS total
      FROM ph_runs.run_results rr
      INNER JOIN ph_releases.release_line_events event
        ON event.id = rr.source_id
       AND event.project_id = rr.project_id
      LEFT JOIN ph_releases.release_versions version
        ON version.id = COALESCE(rr.release_version_id, event.release_version_id)
      WHERE rr.project_id = ${projectId}::uuid
        AND rr.source = 'release'
        AND event.release_line_id = ${releaseLineId}::uuid
        AND ${scopeFilter}
        AND ${versionFilter}
        AND rr.decision_output IS NOT NULL
      GROUP BY rr.decision_output
    `);
    return new Map(
      unwrapRows<Record<string, unknown>>(rows).map((row) => [String(row['category']), Number(row['total'] ?? 0)]),
    );
  }

  async findReleaseVersionCategoryOptions(
    projectId: string,
    releaseLineId: string,
    releaseVersionId: string,
    releaseVersionScope: 'exact' | 'journey',
  ): Promise<{ options: string[]; compatible: boolean }> {
    const versionFilter =
      releaseVersionScope === 'journey'
        ? sql`version.target_production_version_number = selected.target_production_version_number`
        : sql`version.id = selected.id`;
    const rows = await this.db.execute(sql`
      SELECT version.prompt_version_snapshot
      FROM ph_releases.release_versions selected
      INNER JOIN ph_releases.release_versions version
        ON version.project_id = selected.project_id
       AND version.release_line_id = selected.release_line_id
      INNER JOIN ph_releases.release_lines line
        ON line.id = version.release_line_id
       AND line.project_id = version.project_id
      WHERE selected.project_id = ${projectId}::uuid
        AND selected.id = ${releaseVersionId}::uuid
        AND selected.release_line_id = ${releaseLineId}::uuid
        AND ${versionFilter}
        AND line.status <> 'archived'
      ORDER BY version.kind, version.candidate_number NULLS FIRST, version.production_version_number NULLS LAST
    `);
    const optionSets = unwrapRows<Record<string, unknown>>(rows).map((row) =>
      deriveClassificationOptionsFromPromptVersionSnapshot(row['prompt_version_snapshot']),
    );
    if (optionSets.length === 0) return { options: [], compatible: true };
    const firstKey = categoryOptionsKey(optionSets[0] ?? []);
    const compatible = optionSets.every((options) => categoryOptionsKey(options) === firstKey);
    return { options: compatible ? (optionSets[0] ?? []) : [], compatible };
  }

  async createTask(
    projectId: string,
    input: CreateAnnotationTaskInputDto,
    actorUserId: string,
    availableCount: number,
    categoryOptions: string[],
  ): Promise<string> {
    const annotationSchema = JSON.stringify(buildAnnotationSchema(categoryOptions));
    const requestedSampleSize = getRequestedSampleSize(input);
    const categorySampleCounts = getPositiveCategorySampleCounts(input);
    return this.db.transaction(async (tx) => {
      const taskRows = await tx.execute(sql`
        INSERT INTO ph_releases.annotation_tasks (
          scope,
          release_version_id,
          release_version_scope,
          name,
          annotation_schema,
          sampling_config,
          total_sampled,
          total_annotated,
          status,
          created_by,
          created_at,
          updated_at
        )
        SELECT
          ${input.scope},
          version.id,
          ${input.releaseVersionScope},
          ${input.name},
          ${annotationSchema}::jsonb,
          ${JSON.stringify({
            releaseLineId: input.releaseLineId,
            releaseVersionId: input.releaseVersionId,
            releaseVersionScope: input.releaseVersionScope,
            scope: input.scope,
            samplingMode: input.samplingMode,
            availableCount,
            sampleSize: requestedSampleSize,
            categorySampleCounts,
          })}::jsonb,
          0,
          0,
          'active',
          ${actorUserId}::uuid,
          NOW(),
          NOW()
        FROM ph_releases.release_versions version
        INNER JOIN ph_releases.release_lines line
          ON line.id = version.release_line_id
         AND line.project_id = version.project_id
        WHERE version.project_id = ${projectId}::uuid
          AND version.id = ${input.releaseVersionId}::uuid
          AND version.release_line_id = ${input.releaseLineId}::uuid
          AND line.status <> 'archived'
        RETURNING id
      `);
      const taskId = unwrapRows<{ id: string }>(taskRows)[0]?.id;
      if (!taskId) throw new Error('annotation_task_source_not_found');

      const insertedRows = await tx.execute(sql`
        WITH ${sampleCandidateCtesSql(projectId, input, requestedSampleSize, categorySampleCounts)},
        inserted AS (
          INSERT INTO ph_runs.annotations (
            run_result_id,
            run_result_created_at,
            task_id,
            is_correct,
            fields,
            created_at,
            updated_at
          )
          SELECT
            candidates.id,
            candidates.created_at,
            ${taskId}::uuid,
            NULL,
            '{}'::jsonb,
            NOW(),
            NOW()
          FROM candidates
          ON CONFLICT (run_result_id, task_id) DO NOTHING
          RETURNING id
        )
        SELECT COUNT(*)::int AS inserted_count FROM inserted
      `);
      const insertedCount = Number(unwrapRows<Record<string, unknown>>(insertedRows)[0]?.['inserted_count'] ?? 0);
      await tx.execute(sql`
        UPDATE ph_releases.annotation_tasks
        SET total_sampled = ${insertedCount},
            updated_at = NOW()
        WHERE id = ${taskId}::uuid
      `);
      return taskId;
    });
  }

  async listTasks(projectId: string): Promise<AnnotationTaskDto[]> {
    const rows = await this.db.execute(taskSelectSql(sql`version.project_id = ${projectId}::uuid`));
    return unwrapRows<Record<string, unknown>>(rows).map(mapTaskRow);
  }

  async findTask(projectId: string, taskId: string): Promise<AnnotationTaskDto | null> {
    const rows = await this.db.execute(
      taskSelectSql(sql`version.project_id = ${projectId}::uuid AND task.id = ${taskId}::uuid`),
    );
    return unwrapRows<Record<string, unknown>>(rows).map(mapTaskRow)[0] ?? null;
  }

  async listSamples(
    taskId: string,
    filter: { status?: AnnotationSampleStatusDto; limit: number; offset: number },
  ): Promise<AnnotationSampleDto[]> {
    const whereSql = sql.join(buildSampleFilters(taskId, filter.status), sql` AND `);
    const rows = await this.db.execute(sql`
      ${sampleSelectSql(sql`FROM ph_runs.annotations annotation`)}
      WHERE ${whereSql}
      ORDER BY annotation.created_at DESC
      LIMIT ${filter.limit}
      OFFSET ${filter.offset}
    `);
    return unwrapRows<Record<string, unknown>>(rows).map(mapSampleRow);
  }

  async countSamples(taskId: string, status?: AnnotationSampleStatusDto): Promise<number> {
    const whereSql = sql.join(buildSampleFilters(taskId, status), sql` AND `);
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM ph_runs.annotations annotation
      WHERE ${whereSql}
    `);
    return Number(unwrapRows<Record<string, unknown>>(rows)[0]?.['total'] ?? 0);
  }

  async claimSamples(taskId: string, actorUserId: string, batchSize: number): Promise<AnnotationSampleDto[]> {
    const rows = await this.db.execute(sql`
      WITH claimed AS (
        UPDATE ph_runs.annotations
        SET locked_by = ${actorUserId}::uuid,
            locked_at = NOW(),
            lock_heartbeat_at = NOW(),
            updated_at = NOW()
        WHERE id IN (
          SELECT id
          FROM ph_runs.annotations
          WHERE task_id = ${taskId}::uuid
            AND submitted_at IS NULL
            AND (locked_by IS NULL OR lock_heartbeat_at < NOW() - INTERVAL '5 min')
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${batchSize}
        )
        RETURNING *
      )
      ${sampleSelectSql(sql`FROM claimed annotation`)}
      ORDER BY annotation.created_at ASC
    `);
    return unwrapRows<Record<string, unknown>>(rows).map(mapSampleRow);
  }

  async submitSample(
    taskId: string,
    annotationId: string,
    actorUserId: string,
    payload: { expectedOutput: string; notes: string | null },
  ): Promise<AnnotationSampleDto | null> {
    const rows = await this.db.execute(sql`
      WITH updated AS (
        UPDATE ph_runs.annotations annotation
        SET fields = jsonb_build_object('expected_output', ${payload.expectedOutput}::text),
            is_correct = CASE
              WHEN rr.decision_output IS NULL THEN NULL
              ELSE rr.decision_output = ${payload.expectedOutput}
            END,
            notes = ${payload.notes},
            locked_by = ${actorUserId}::uuid,
            locked_at = CASE
              WHEN annotation.locked_by = ${actorUserId}::uuid THEN annotation.locked_at
              ELSE NOW()
            END,
            lock_heartbeat_at = NOW(),
            submitted_by = ${actorUserId}::uuid,
            submitted_at = NOW(),
            updated_at = NOW()
        FROM ph_runs.run_results rr
        WHERE annotation.run_result_id = rr.id
          AND annotation.id = ${annotationId}::uuid
          AND annotation.task_id = ${taskId}::uuid
          AND annotation.submitted_at IS NULL
          AND (
            annotation.locked_by = ${actorUserId}::uuid
            OR annotation.locked_by IS NULL
            OR annotation.lock_heartbeat_at < NOW() - INTERVAL '5 min'
          )
        RETURNING annotation.*
      ),
      task_progress AS (
        UPDATE ph_releases.annotation_tasks task
        SET total_annotated = (
              SELECT COUNT(*)::int
              FROM ph_runs.annotations annotation
              WHERE annotation.task_id = task.id
                AND annotation.submitted_at IS NOT NULL
            ),
            status = CASE
              WHEN (
                SELECT COUNT(*)::int
                FROM ph_runs.annotations annotation
                WHERE annotation.task_id = task.id
                  AND annotation.submitted_at IS NOT NULL
              ) >= NULLIF(task.total_sampled, 0)
              THEN 'completed'
              ELSE task.status
            END,
            updated_at = NOW()
        WHERE task.id IN (SELECT task_id FROM updated)
        RETURNING id
      )
      ${sampleSelectSql(sql`FROM updated annotation`)}
      LIMIT 1
    `);
    return unwrapRows<Record<string, unknown>>(rows).map(mapSampleRow)[0] ?? null;
  }

  async releaseSample(taskId: string, annotationId: string, actorUserId: string): Promise<AnnotationSampleDto | null> {
    const rows = await this.db.execute(sql`
      WITH updated AS (
        UPDATE ph_runs.annotations
        SET locked_by = NULL,
            locked_at = NULL,
            lock_heartbeat_at = NULL,
            updated_at = NOW()
        WHERE id = ${annotationId}::uuid
          AND task_id = ${taskId}::uuid
          AND locked_by = ${actorUserId}::uuid
          AND submitted_at IS NULL
        RETURNING *
      )
      ${sampleSelectSql(sql`FROM updated annotation`)}
      LIMIT 1
    `);
    return unwrapRows<Record<string, unknown>>(rows).map(mapSampleRow)[0] ?? null;
  }
}

function taskSelectSql(whereSql: SQL): SQL {
  return sql`
    SELECT
      task.id,
      version.project_id,
      task.name,
      task.scope,
      task.release_version_scope,
      task.status,
      task.annotation_schema,
      task.created_by,
      task.created_at,
      task.updated_at,
      line.id AS release_line_id,
      line.name AS release_line_name,
      version.id AS release_version_id,
      version.kind AS release_version_kind,
      version.production_version_number,
      version.target_production_version_number,
      version.candidate_number,
      version.prompt_name,
      version.prompt_version_id,
      version.prompt_version_number,
      version.prompt_version_snapshot,
      version.model_id,
      COALESCE(version.model_snapshot->>'name', model.name) AS model_name,
      COALESCE(
        version.model_snapshot->>'providerType',
        version.model_snapshot->>'provider',
        model.provider_type
      ) AS model_provider,
      COUNT(annotation.id)::int AS total,
      COUNT(annotation.id) FILTER (
        WHERE annotation.submitted_at IS NULL
          AND annotation.locked_by IS NOT NULL
          AND annotation.lock_heartbeat_at >= NOW() - INTERVAL '5 min'
      )::int AS claimed,
      COUNT(annotation.id) FILTER (WHERE annotation.submitted_at IS NOT NULL)::int AS submitted,
      COUNT(annotation.id) FILTER (
        WHERE annotation.submitted_at IS NOT NULL
          AND annotation.fields->>'expected_output' IS NOT NULL
          AND rr.decision_output IS NOT NULL
          AND annotation.fields->>'expected_output' = rr.decision_output
      )::int AS matched,
      COUNT(annotation.id) FILTER (
        WHERE annotation.submitted_at IS NOT NULL
          AND annotation.fields->>'expected_output' IS NOT NULL
          AND (rr.decision_output IS NULL OR annotation.fields->>'expected_output' <> rr.decision_output)
      )::int AS mismatched
    FROM ph_releases.annotation_tasks task
    INNER JOIN ph_releases.release_versions version ON version.id = task.release_version_id
    INNER JOIN ph_releases.release_lines line ON line.id = version.release_line_id
    LEFT JOIN ph_assets.models model ON model.id = version.model_id
    LEFT JOIN ph_runs.annotations annotation ON annotation.task_id = task.id
    LEFT JOIN ph_runs.run_results rr ON rr.id = annotation.run_result_id
    WHERE ${whereSql}
    GROUP BY
      task.id,
      version.project_id,
      task.name,
      task.scope,
      task.release_version_scope,
      task.status,
      task.annotation_schema,
      task.created_by,
      task.created_at,
      task.updated_at,
      line.id,
      line.name,
      version.id,
      version.kind,
      version.production_version_number,
      version.target_production_version_number,
      version.candidate_number,
      version.prompt_name,
      version.prompt_version_id,
      version.prompt_version_number,
      version.prompt_version_snapshot,
      version.model_id,
      version.model_snapshot,
      model.name,
      model.provider_type
    ORDER BY task.created_at DESC
  `;
}

function sampleSelectSql(fromSql: SQL): SQL {
  return sql`
    SELECT
      annotation.id,
      annotation.task_id,
      annotation.run_result_id,
      annotation.run_result_created_at,
      annotation.is_correct,
      annotation.fields,
      annotation.notes,
      annotation.locked_by,
      annotation.locked_at,
      annotation.lock_heartbeat_at,
      annotation.submitted_at,
      annotation.submitted_by,
      annotation.created_at,
      annotation.updated_at,
      rr.external_id,
      rr.input_variables,
      rr.rendered_prompt,
      rr.decision_output,
      rr.expected_output,
      rr.raw_response,
      rr.parsed_output,
      rr.latency_ms,
      rr.input_tokens,
      rr.output_tokens
    ${fromSql}
    LEFT JOIN ph_runs.run_results rr ON rr.id = annotation.run_result_id
  `;
}

function buildSampleFilters(taskId: string, status?: AnnotationSampleStatusDto): SQL[] {
  const filters: SQL[] = [sql`annotation.task_id = ${taskId}::uuid`];
  if (status === 'pending') {
    filters.push(sql`annotation.submitted_at IS NULL`);
    filters.push(sql`(annotation.locked_by IS NULL OR annotation.lock_heartbeat_at < NOW() - INTERVAL '5 min')`);
  } else if (status === 'claimed') {
    filters.push(sql`annotation.submitted_at IS NULL`);
    filters.push(sql`annotation.locked_by IS NOT NULL`);
    filters.push(sql`annotation.lock_heartbeat_at >= NOW() - INTERVAL '5 min'`);
  } else if (status === 'submitted') {
    filters.push(sql`annotation.submitted_at IS NOT NULL`);
  }
  return filters;
}

function mapTaskRow(row: Record<string, unknown>): AnnotationTaskDto {
  const total = Number(row['total'] ?? 0);
  const claimed = Number(row['claimed'] ?? 0);
  const submitted = Number(row['submitted'] ?? 0);
  const matched = Number(row['matched'] ?? 0);
  const mismatched = Number(row['mismatched'] ?? 0);
  const judged = matched + mismatched;
  return {
    id: row['id'] as string,
    projectId: row['project_id'] as string,
    name: String(row['name'] ?? ''),
    scope: row['scope'] as AnnotationTaskScopeDto,
    releaseLineId: row['release_line_id'] as string,
    releaseLineName: String(row['release_line_name'] ?? ''),
    releaseVersionId: row['release_version_id'] as string,
    releaseVersionLabel: formatReleaseVersionLabel(row),
    releaseVersionScope: (row['release_version_scope'] as AnnotationTaskDto['releaseVersionScope']) ?? 'exact',
    promptName: String(row['prompt_name'] ?? ''),
    promptVersionId: row['prompt_version_id'] as string,
    promptVersionNumber: toNumberOrNull(row['prompt_version_number'] as number | string | null),
    promptVersionLabel: formatPromptVersionLabel(row['prompt_version_number'] as number | string | null),
    categoryOptions: getTaskCategoryOptions(row),
    modelId: row['model_id'] as string,
    modelName: (row['model_name'] as string | null) ?? null,
    modelProvider: (row['model_provider'] as string | null) ?? null,
    status: total > 0 && submitted >= total ? 'completed' : (row['status'] as AnnotationTaskDto['status']),
    progress: {
      total,
      claimed,
      submitted,
      pending: Math.max(0, total - submitted - claimed),
    },
    quality: judged > 0 ? { matched, mismatched, score: matched / judged } : null,
    createdBy: row['created_by'] as string,
    createdAt: toIsoString(row['created_at']),
    updatedAt: toIsoString(row['updated_at']),
  };
}

function mapSampleRow(row: Record<string, unknown>): AnnotationSampleDto {
  const fields = isRecord(row['fields']) ? row['fields'] : {};
  return {
    id: row['id'] as string,
    taskId: row['task_id'] as string,
    runResultId: row['run_result_id'] as string,
    externalId: (row['external_id'] as string | null) ?? null,
    inputPreview: previewValue(row['input_variables']),
    outputPreview: row['decision_output']
      ? String(row['decision_output'])
      : (previewValue(row['parsed_output']) ?? previewValue(row['raw_response'])),
    inputVariables: isRecord(row['input_variables']) ? row['input_variables'] : null,
    renderedPrompt: row['rendered_prompt'] ?? null,
    decisionOutput: (row['decision_output'] as string | null) ?? null,
    expectedOutput: (row['expected_output'] as string | null) ?? null,
    annotatedExpectedOutput: typeof fields['expected_output'] === 'string' ? fields['expected_output'] : null,
    isCorrect: (row['is_correct'] as boolean | null) ?? null,
    rawResponse: (row['raw_response'] as string | null) ?? null,
    parsedOutput: row['parsed_output'] ?? null,
    latencyMs: toNumberOrNull(row['latency_ms'] as number | string | null),
    inputTokens: toNumberOrNull(row['input_tokens'] as number | string | null),
    outputTokens: toNumberOrNull(row['output_tokens'] as number | string | null),
    notes: (row['notes'] as string | null) ?? null,
    lockedBy: (row['locked_by'] as string | null) ?? null,
    lockedAt: row['locked_at'] ? toIsoString(row['locked_at']) : null,
    lockHeartbeatAt: row['lock_heartbeat_at'] ? toIsoString(row['lock_heartbeat_at']) : null,
    submittedAt: row['submitted_at'] ? toIsoString(row['submitted_at']) : null,
    submittedBy: (row['submitted_by'] as string | null) ?? null,
    createdAt: toIsoString(row['created_at']),
  };
}

function buildAnnotationSchema(categoryOptions: string[]) {
  return [
    {
      name: 'expected_output',
      label: 'expected_output',
      type: 'select',
      required: true,
      options: categoryOptions,
    },
  ];
}

function sampleCandidateCtesSql(
  projectId: string,
  input: CreateAnnotationTaskInputDto,
  sampleSize: number,
  categorySampleCounts: Array<{ category: string; sampleSize: number }>,
): SQL {
  const scopeFilter = scopeFilterSql(input.scope);
  const versionFilter = releaseVersionFilterSql(input.releaseVersionId, input.releaseVersionScope);
  if (input.samplingMode === 'per_category') {
    const categoryRequestsJson = JSON.stringify(
      categorySampleCounts.map((item) => ({ category: item.category, sample_size: item.sampleSize })),
    );
    return sql`
      requested_categories AS (
        SELECT category, sample_size
        FROM jsonb_to_recordset(${categoryRequestsJson}::jsonb) AS requested(category text, sample_size int)
        WHERE sample_size > 0
      ),
      ranked_candidates AS (
        SELECT
          rr.id,
          rr.created_at,
          rr.decision_output,
          ROW_NUMBER() OVER (PARTITION BY rr.decision_output ORDER BY random()) AS category_rank
        FROM ph_runs.run_results rr
        INNER JOIN ph_releases.release_line_events event
          ON event.id = rr.source_id
         AND event.project_id = rr.project_id
        LEFT JOIN ph_releases.release_versions version
          ON version.id = COALESCE(rr.release_version_id, event.release_version_id)
        INNER JOIN requested_categories requested
          ON requested.category = rr.decision_output
        WHERE rr.project_id = ${projectId}::uuid
          AND rr.source = 'release'
          AND event.release_line_id = ${input.releaseLineId}::uuid
          AND ${scopeFilter}
          AND ${versionFilter}
      ),
      candidates AS (
        SELECT ranked_candidates.id, ranked_candidates.created_at
        FROM ranked_candidates
        INNER JOIN requested_categories requested
          ON requested.category = ranked_candidates.decision_output
        WHERE ranked_candidates.category_rank <= requested.sample_size
      )
    `;
  }

  return sql`
    candidates AS (
      SELECT rr.id, rr.created_at
      FROM ph_runs.run_results rr
      INNER JOIN ph_releases.release_line_events event
        ON event.id = rr.source_id
       AND event.project_id = rr.project_id
      LEFT JOIN ph_releases.release_versions version
        ON version.id = COALESCE(rr.release_version_id, event.release_version_id)
      WHERE rr.project_id = ${projectId}::uuid
        AND rr.source = 'release'
        AND event.release_line_id = ${input.releaseLineId}::uuid
        AND ${scopeFilter}
        AND ${versionFilter}
      ORDER BY random()
      LIMIT ${sampleSize}
    )
  `;
}

function getRequestedSampleSize(input: CreateAnnotationTaskInputDto): number {
  if (input.samplingMode === 'per_category') {
    return getPositiveCategorySampleCounts(input).reduce((sum, item) => sum + item.sampleSize, 0);
  }
  return input.sampleSize ?? 0;
}

function getPositiveCategorySampleCounts(
  input: CreateAnnotationTaskInputDto,
): Array<{ category: string; sampleSize: number }> {
  return (input.categorySampleCounts ?? []).filter((item) => item.sampleSize > 0);
}

function getTaskCategoryOptions(row: Record<string, unknown>): string[] {
  const fromSchema = deriveClassificationOptionsFromAnnotationSchema(row['annotation_schema']);
  if (fromSchema.length > 0) return fromSchema;
  return deriveClassificationOptionsFromPromptVersionSnapshot(row['prompt_version_snapshot']);
}

function scopeFilterSql(scope: AnnotationTaskScopeDto): SQL {
  if (scope === 'all') return sql`TRUE`;
  return sql`event.lane_type = ${scopeToLane(scope)}`;
}

function scopeToLane(scope: Exclude<AnnotationTaskScopeDto, 'all'>): 'canary' | 'production' {
  return scope === 'online' ? 'production' : 'canary';
}

function parseCategoryCounts(value: unknown, categoryOptions: string[]): Array<{ category: string; count: number }> {
  const counts = parseCountMap(value);
  const categories = categoryOptions.length > 0 ? categoryOptions : Array.from(counts.keys()).sort();
  return categories.map((category) => ({ category, count: counts.get(category) ?? 0 }));
}

function parseCountMap(value: unknown): Map<string, number> {
  const raw = parseRecord(value);
  return new Map(
    Object.entries(raw)
      .map(([category, count]) => [category, Number(count)] as const)
      .filter((entry): entry is readonly [string, number] => entry[0].length > 0 && Number.isFinite(entry[1])),
  );
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function releaseVersionFilterSql(releaseVersionId: string, releaseVersionScope: 'exact' | 'journey'): SQL {
  // The version table is LEFT JOINed so that release-line traffic whose
  // release_version_id was nulled out by a run-config / route change (both
  // rr.release_version_id and event.release_version_id NULL) is still reachable.
  // For the version-scoped ('exact') path we restrict to the specific version,
  // and a NULL-version row legitimately does not match it. For the
  // non-version-scoped ('journey') path the task spans the whole release-line
  // journey, so those detached NULL-version rows must be included.
  if (releaseVersionScope === 'exact') return sql`version.id = ${releaseVersionId}::uuid`;
  return sql`(
    version.id IS NULL
    OR version.target_production_version_number = (
      SELECT selected.target_production_version_number
      FROM ph_releases.release_versions selected
      WHERE selected.id = ${releaseVersionId}::uuid
        AND selected.release_line_id = version.release_line_id
      LIMIT 1
    )
  )`;
}

function categoryOptionsKey(options: string[]): string {
  // Canonicalize for set-equality comparison only: identical category sets in
  // different declaration order must produce the same key. This key is used
  // solely for compatibility checks, never to derive the displayed/stored
  // option order (which is preserved from the source snapshot).
  return JSON.stringify([...options].sort());
}

function unwrapRows<T = unknown>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
    return ((result as { rows?: T[] }).rows ?? []) as T[];
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function previewValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 500);
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

function toIsoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatReleaseVersionLabel(row: Record<string, unknown>): string {
  const kind = row['release_version_kind'] ?? row['kind'];
  const productionVersionNumber = toNumberOrNull(row['production_version_number'] as number | string | null);
  const targetProductionVersionNumber =
    toNumberOrNull(row['target_production_version_number'] as number | string | null) ?? 1;
  const candidateNumber = toNumberOrNull(row['candidate_number'] as number | string | null) ?? 0;
  if (kind === 'production') return `v${productionVersionNumber ?? targetProductionVersionNumber}`;
  return `v${Math.max(0, targetProductionVersionNumber - 1)}.${candidateNumber}`;
}

function formatPromptVersionLabel(value: number | string | null): string | null {
  const num = toNumberOrNull(value);
  return num ? `v${num}` : null;
}
