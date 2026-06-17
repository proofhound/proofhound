import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '@proofhound/db';
import { sql } from 'drizzle-orm';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

export interface ReleaseRunnerLineRow {
  id: string;
  projectId: string;
  inputConnectorId: string;
  inputConnectorType: string;
  inputConnectorDirection: string;
  inputConnectorConfig: Record<string, unknown>;
  inputConnectorConfigEncrypted: unknown;
  production: ReleaseRunnerLaneRow | null;
  canary: ReleaseRunnerLaneRow | null;
}

export interface ReleaseRunnerLaneRow {
  id: string;
  releaseLineId: string;
  projectId: string;
  releaseVersionId: string | null;
  laneType: 'production' | 'canary';
  promptName: string;
  promptVersionId: string;
  promptId: string;
  modelId: string;
  outputConnectorIds: string[];
  status: string;
  controlState: string | null;
  controlStatePayload: unknown;
  trafficRatio: number | null;
  trafficMode: 'split' | 'dual_run' | null;
  recordMode: string;
  recordCategories: string[];
  filterRules: unknown;
  variableMapping: unknown;
  outputMapping: unknown;
  externalIdField: string;
  runConfig: Record<string, unknown>;
  totalProcessed: number;
  totalErrors: number;
  startedAt: Date | null;
  promptBody: string;
  promptVariables: unknown;
  promptOutputSchema: unknown;
  promptJudgmentRules: unknown;
  promptLanguage: string;
  createdBy: string;
}

export interface ReleaseOutputConnectorRow {
  id: string;
  type: string;
  direction: string;
  config: Record<string, unknown>;
  configEncrypted: unknown;
}

export interface ReleaseCompletedRunResultRow {
  id: string;
  projectId: string;
  createdAt: Date;
  externalId: string | null;
  status: string;
  rawResponse: string | null;
  parsedOutput: unknown;
  decisionOutput: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costEstimate: number | null;
}

@Injectable()
export class ReleaseRunnerRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  async listRunnableLines(limit = 50): Promise<ReleaseRunnerLineRow[]> {
    const rows = await this.db.execute(sql`
      SELECT
        line.id,
        line.project_id,
        line.input_connector_id,
        ic.type AS input_connector_type,
        ic.direction AS input_connector_direction,
        ic.config AS input_connector_config,
        ic.config_encrypted AS input_connector_config_encrypted,
        ${laneSelectSql('prod')},
        ${laneSelectSql('canary')}
      FROM ph_releases.release_lines line
      INNER JOIN ph_assets.connectors ic ON ic.id = line.input_connector_id
      LEFT JOIN ph_releases.release_line_events prod
        ON prod.id = line.current_production_event_id
       AND prod.status = 'running'
       AND prod.lane_type = 'production'
      LEFT JOIN ph_releases.release_line_events canary
        ON canary.id = line.active_canary_event_id
       AND canary.status = 'running'
       AND canary.lane_type = 'canary'
      WHERE line.status <> 'archived'
        AND line.input_connector_id IS NOT NULL
        AND ic.deleted_at IS NULL
        AND (prod.id IS NOT NULL OR canary.id IS NOT NULL)
      ORDER BY line.updated_at ASC
      LIMIT ${limit}
    `);
    return unwrapRows<Record<string, unknown>>(rows).map(mapLineRow);
  }

  async findRunnableLine(releaseLineId: string): Promise<ReleaseRunnerLineRow | null> {
    const rows = await this.db.execute(sql`
      SELECT
        line.id,
        line.project_id,
        line.input_connector_id,
        ic.type AS input_connector_type,
        ic.direction AS input_connector_direction,
        ic.config AS input_connector_config,
        ic.config_encrypted AS input_connector_config_encrypted,
        ${laneSelectSql('prod')},
        ${laneSelectSql('canary')}
      FROM ph_releases.release_lines line
      INNER JOIN ph_assets.connectors ic ON ic.id = line.input_connector_id
      LEFT JOIN ph_releases.release_line_events prod
        ON prod.id = line.current_production_event_id
       AND prod.status = 'running'
       AND prod.lane_type = 'production'
      LEFT JOIN ph_releases.release_line_events canary
        ON canary.id = line.active_canary_event_id
       AND canary.status = 'running'
       AND canary.lane_type = 'canary'
      WHERE line.id = ${releaseLineId}::uuid
        AND line.status <> 'archived'
        AND line.input_connector_id IS NOT NULL
        AND ic.deleted_at IS NULL
        AND (prod.id IS NOT NULL OR canary.id IS NOT NULL)
      LIMIT 1
    `);
    const row = unwrapRows<Record<string, unknown>>(rows)[0];
    return row ? mapLineRow(row) : null;
  }

  async listOutputConnectorsByIds(projectId: string, connectorIds: string[]): Promise<ReleaseOutputConnectorRow[]> {
    if (connectorIds.length === 0) return [];
    const rows = await this.db.execute(sql`
      SELECT id, type, direction, config, config_encrypted
      FROM ph_assets.connectors
      WHERE id IN (${uuidList(connectorIds)})
        AND project_id = ${projectId}::uuid
        AND direction = 'output'
        AND deleted_at IS NULL
    `);
    const byId = new Map(
      unwrapRows<Record<string, unknown>>(rows).map((row) => [
        row['id'] as string,
        {
          id: row['id'] as string,
          type: row['type'] as string,
          direction: row['direction'] as string,
          config: (row['config'] as Record<string, unknown> | null) ?? {},
          configEncrypted: row['config_encrypted'],
        },
      ]),
    );
    return connectorIds.flatMap((id) => byId.get(id) ?? []);
  }

  async incrementReceived(eventId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ph_releases.release_line_events
      SET total_received = total_received + 1,
          updated_at = NOW()
      WHERE id = ${eventId}::uuid
    `);
  }

  async incrementFiltered(eventId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ph_releases.release_line_events
      SET total_filtered = total_filtered + 1,
          updated_at = NOW()
      WHERE id = ${eventId}::uuid
    `);
  }

  async attachCompletedRunResults(eventId: string, limit = 200): Promise<ReleaseCompletedRunResultRow[]> {
    const rows = await this.db.execute(sql`
      WITH release_event AS (
        SELECT total_processed
        FROM ph_releases.release_line_events
        WHERE id = ${eventId}::uuid
        LIMIT 1
      ),
      ranked AS (
        SELECT
          rr.id,
          rr.project_id,
          rr.created_at,
          rr.external_id,
          rr.status,
          rr.raw_response,
          rr.parsed_output,
          rr.decision_output,
          rr.judgment_status,
          rr.expected_output,
          rr.error_class,
          rr.error_message,
          rr.latency_ms,
          rr.input_tokens,
          rr.output_tokens,
          rr.cost_estimate,
          rr.is_correct,
          release_event.total_processed,
          ROW_NUMBER() OVER (ORDER BY rr.created_at ASC) AS row_number
        FROM ph_runs.run_results rr
        CROSS JOIN release_event
        WHERE rr.source = 'release'
          AND rr.source_id = ${eventId}::uuid
      ),
      candidates AS (
        SELECT
          id,
          project_id,
          created_at,
          external_id,
          status,
          raw_response,
          parsed_output,
          decision_output,
          judgment_status,
          expected_output,
          error_class,
          error_message,
          latency_ms,
          input_tokens,
          output_tokens,
          cost_estimate,
          is_correct
        FROM ranked
        WHERE row_number > total_processed
        ORDER BY created_at ASC
        LIMIT ${limit}
      ),
      inserted_with_status AS (
        SELECT c.status, c.judgment_status, c.expected_output, c.is_correct
        FROM candidates c
      ),
      updated AS (
        UPDATE ph_releases.release_line_events
        SET total_processed = total_processed + (SELECT COUNT(*)::int FROM inserted_with_status),
            total_errors = total_errors + (
              SELECT COUNT(*)::int FROM inserted_with_status WHERE ${runResultFailureSql()}
            ),
            total_correct = total_correct + (
              SELECT COUNT(*)::int FROM inserted_with_status WHERE is_correct IS TRUE
            ),
            updated_at = CASE
              WHEN (SELECT COUNT(*) FROM inserted_with_status) > 0 THEN NOW()
              ELSE updated_at
            END
        WHERE id = ${eventId}::uuid
        RETURNING id
      )
      SELECT
        c.id,
        c.project_id,
        c.created_at,
        c.external_id,
        c.status,
        c.raw_response,
        c.parsed_output,
        c.decision_output,
        c.error_class,
        c.error_message,
        c.latency_ms,
        c.input_tokens,
	        c.output_tokens,
	        c.cost_estimate
	      FROM candidates c
	      ORDER BY c.created_at ASC
	    `);
    return unwrapRows<Record<string, unknown>>(rows).map(mapCompletedRunResult);
  }

  async recordOutputDelivery(eventId: string, counts: { successCount: number; failedCount: number }): Promise<void> {
    const successCount = Math.max(0, Math.trunc(counts.successCount));
    const failedCount = Math.max(0, Math.trunc(counts.failedCount));
    if (successCount === 0 && failedCount === 0) return;
    await this.db.execute(sql`
      UPDATE ph_releases.release_line_events
      SET metrics = jsonb_set(
            jsonb_set(
              COALESCE(metrics, '{}'::jsonb),
              '{downstreamDeliverySuccess}',
              to_jsonb((COALESCE((metrics->>'downstreamDeliverySuccess')::int, 0) + ${successCount})::int),
              true
            ),
            '{downstreamDeliveryFailed}',
            to_jsonb((COALESCE((metrics->>'downstreamDeliveryFailed')::int, 0) + ${failedCount})::int),
            true
          ),
          updated_at = NOW()
      WHERE id = ${eventId}::uuid
    `);
  }

  async transitionLaneStatus(
    eventId: string,
    status: 'running' | 'stopped' | 'completed' | 'failed' | 'cancelled',
    options: {
      terminalReason?: string | null;
      clearControlState?: boolean;
      metricsPatch?: Record<string, unknown>;
    } = {},
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE ph_releases.release_line_events
      SET status = ${status},
          terminal_reason = ${options.terminalReason ?? null},
          control_state = CASE WHEN ${options.clearControlState === true} THEN NULL ELSE control_state END,
          control_state_payload = CASE WHEN ${options.clearControlState === true} THEN NULL ELSE control_state_payload END,
          metrics = COALESCE(metrics, '{}'::jsonb) || ${JSON.stringify(options.metricsPatch ?? {})}::jsonb,
          finished_at = CASE WHEN ${status} IN ('stopped', 'completed', 'failed', 'cancelled') THEN NOW() ELSE finished_at END,
          updated_at = NOW()
      WHERE id = ${eventId}::uuid
    `);
    await this.refreshLinePointersByEvent(eventId);
  }

  async clearControlState(eventId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ph_releases.release_line_events
      SET control_state = NULL,
          control_state_payload = NULL,
          updated_at = NOW()
      WHERE id = ${eventId}::uuid
    `);
  }

  private async refreshLinePointersByEvent(eventId: string): Promise<void> {
    await this.db.execute(sql`
      WITH target_line AS (
        SELECT release_line_id
        FROM ph_releases.release_line_events
        WHERE id = ${eventId}::uuid
      ),
      current_production AS (
        SELECT DISTINCT ON (release_line_id)
          release_line_id,
          id,
          status
        FROM ph_releases.release_line_events
        WHERE release_line_id IN (SELECT release_line_id FROM target_line)
          AND lane_type = 'production'
          AND status IN ('running', 'stopped', 'archived')
        ORDER BY release_line_id, created_at DESC
      ),
      active_canary AS (
        SELECT DISTINCT ON (release_line_id)
          release_line_id,
          id,
          status
        FROM ph_releases.release_line_events
        WHERE release_line_id IN (SELECT release_line_id FROM target_line)
          AND lane_type = 'canary'
          AND status IN ('running', 'stopped', 'archived')
        ORDER BY release_line_id, created_at DESC
      )
      UPDATE ph_releases.release_lines line
      SET current_production_event_id = current_production.id,
          active_canary_event_id = active_canary.id,
          status = CASE
            WHEN line.status = 'archived' THEN 'archived'
            WHEN current_production.status = 'running' OR active_canary.status = 'running' THEN 'running'
            ELSE 'stopped'
          END,
          archived_at = CASE WHEN line.status = 'archived' THEN line.archived_at ELSE NULL END,
          updated_at = NOW()
      FROM target_line
      LEFT JOIN current_production ON current_production.release_line_id = target_line.release_line_id
      LEFT JOIN active_canary ON active_canary.release_line_id = target_line.release_line_id
      WHERE line.id = target_line.release_line_id
    `);
  }
}

function laneSelectSql(alias: 'prod' | 'canary') {
  return sql.raw(`
        ${alias}.id AS ${alias}_id,
        ${alias}.release_line_id AS ${alias}_release_line_id,
        ${alias}.project_id AS ${alias}_project_id,
        ${alias}.release_version_id AS ${alias}_release_version_id,
        ${alias}.lane_type AS ${alias}_lane_type,
        ${alias}.prompt_name AS ${alias}_prompt_name,
        ${alias}.prompt_version_id AS ${alias}_prompt_version_id,
        ${alias}.prompt_id AS ${alias}_prompt_id,
        ${alias}.model_id AS ${alias}_model_id,
        ${alias}.output_connector_ids AS ${alias}_output_connector_ids,
        ${alias}.status AS ${alias}_status,
        ${alias}.control_state AS ${alias}_control_state,
        ${alias}.control_state_payload AS ${alias}_control_state_payload,
        ${alias}.traffic_ratio AS ${alias}_traffic_ratio,
        ${alias}.traffic_mode AS ${alias}_traffic_mode,
        ${alias}.record_mode AS ${alias}_record_mode,
        ${alias}.record_categories AS ${alias}_record_categories,
        ${alias}.filter_rules AS ${alias}_filter_rules,
        ${alias}.variable_mapping AS ${alias}_variable_mapping,
        ${alias}.output_mapping AS ${alias}_output_mapping,
        ${alias}.external_id_field AS ${alias}_external_id_field,
        ${alias}.run_config AS ${alias}_run_config,
        ${alias}.total_processed AS ${alias}_total_processed,
        ${alias}.total_errors AS ${alias}_total_errors,
        ${alias}.started_at AS ${alias}_started_at,
        COALESCE(${alias}.prompt_version_snapshot->>'body', '') AS ${alias}_prompt_body,
        ${alias}.prompt_version_snapshot->'variables' AS ${alias}_prompt_variables,
        ${alias}.prompt_version_snapshot->'outputSchema' AS ${alias}_prompt_output_schema,
        ${alias}.prompt_version_snapshot->'judgmentRules' AS ${alias}_prompt_judgment_rules,
        COALESCE(${alias}.prompt_version_snapshot->>'promptLanguage', 'zh-CN') AS ${alias}_prompt_language,
        ${alias}.created_by AS ${alias}_created_by
  `);
}

function mapLineRow(row: Record<string, unknown>): ReleaseRunnerLineRow {
  return {
    id: row['id'] as string,
    projectId: row['project_id'] as string,
    inputConnectorId: row['input_connector_id'] as string,
    inputConnectorType: row['input_connector_type'] as string,
    inputConnectorDirection: row['input_connector_direction'] as string,
    inputConnectorConfig: (row['input_connector_config'] as Record<string, unknown> | null) ?? {},
    inputConnectorConfigEncrypted: row['input_connector_config_encrypted'],
    production: mapLaneRow(row, 'prod'),
    canary: mapLaneRow(row, 'canary'),
  };
}

function mapLaneRow(row: Record<string, unknown>, prefix: 'prod' | 'canary'): ReleaseRunnerLaneRow | null {
  const id = row[`${prefix}_id`];
  if (typeof id !== 'string') return null;
  return {
    id,
    releaseLineId: row[`${prefix}_release_line_id`] as string,
    projectId: row[`${prefix}_project_id`] as string,
    releaseVersionId: (row[`${prefix}_release_version_id`] as string | null) ?? null,
    laneType: row[`${prefix}_lane_type`] as 'production' | 'canary',
    promptName: (row[`${prefix}_prompt_name`] as string | null) ?? 'release',
    promptVersionId: row[`${prefix}_prompt_version_id`] as string,
    promptId: row[`${prefix}_prompt_id`] as string,
    modelId: row[`${prefix}_model_id`] as string,
    outputConnectorIds: normalizeStringArray(row[`${prefix}_output_connector_ids`]),
    status: row[`${prefix}_status`] as string,
    controlState: (row[`${prefix}_control_state`] as string | null) ?? null,
    controlStatePayload: row[`${prefix}_control_state_payload`],
    trafficRatio: toNumberOrNull(row[`${prefix}_traffic_ratio`] as number | string | null),
    trafficMode: (row[`${prefix}_traffic_mode`] as 'split' | 'dual_run' | null) ?? null,
    recordMode: (row[`${prefix}_record_mode`] as string | null) ?? 'all',
    recordCategories: normalizeStringArray(row[`${prefix}_record_categories`]),
    filterRules: row[`${prefix}_filter_rules`],
    variableMapping: row[`${prefix}_variable_mapping`],
    outputMapping: row[`${prefix}_output_mapping`],
    externalIdField: (row[`${prefix}_external_id_field`] as string | null) ?? 'id',
    runConfig: (row[`${prefix}_run_config`] as Record<string, unknown> | null) ?? {},
    totalProcessed: Number(row[`${prefix}_total_processed`] ?? 0),
    totalErrors: Number(row[`${prefix}_total_errors`] ?? 0),
    startedAt: row[`${prefix}_started_at`] ? new Date(row[`${prefix}_started_at`] as string | Date) : null,
    promptBody: (row[`${prefix}_prompt_body`] as string | null) ?? '',
    promptVariables: row[`${prefix}_prompt_variables`],
    promptOutputSchema: row[`${prefix}_prompt_output_schema`],
    promptJudgmentRules: row[`${prefix}_prompt_judgment_rules`],
    promptLanguage: (row[`${prefix}_prompt_language`] as string | null) ?? 'zh-CN',
    createdBy: row[`${prefix}_created_by`] as string,
  };
}

function mapCompletedRunResult(row: Record<string, unknown>): ReleaseCompletedRunResultRow {
  return {
    id: row['id'] as string,
    projectId: row['project_id'] as string,
    createdAt: row['created_at'] ? new Date(row['created_at'] as string | Date) : new Date(0),
    externalId: (row['external_id'] as string | null) ?? null,
    status: row['status'] as string,
    rawResponse: (row['raw_response'] as string | null) ?? null,
    parsedOutput: row['parsed_output'],
    decisionOutput: (row['decision_output'] as string | null) ?? null,
    errorClass: (row['error_class'] as string | null) ?? null,
    errorMessage: (row['error_message'] as string | null) ?? null,
    latencyMs: toNumberOrNull(row['latency_ms'] as number | string | null),
    inputTokens: toNumberOrNull(row['input_tokens'] as number | string | null),
    outputTokens: toNumberOrNull(row['output_tokens'] as number | string | null),
    costEstimate: toNumberOrNull(row['cost_estimate'] as number | string | null),
  };
}

function runResultFailureSql() {
  return sql`
    status = 'failed'
    OR judgment_status = 'parse_error'
    OR (judgment_status = 'judge_error' AND expected_output IS NOT NULL)
  `;
}

function uuidList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function unwrapRows<T = unknown>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
    return ((result as { rows?: T[] }).rows ?? []) as T[];
  }
  return [];
}
