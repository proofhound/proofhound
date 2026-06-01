import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '@proofhound/db';
import { isRunResultFailure } from '@proofhound/shared';
import { sql } from 'drizzle-orm';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

export interface WebhookConnectorRow {
  id: string;
  projectId: string;
  name: string;
  config: Record<string, unknown>;
  webhookPath: string | null;
  ipWhitelist: string[] | null;
}

export interface WebhookConnectorTokenResult {
  connector: WebhookConnectorRow;
  tokenId: string;
  tokenExpiresAt: Date | string | null;
}

export interface WebhookReleaseRuntimeLineRow {
  id: string;
  projectId: string;
  production: WebhookReleaseRuntimeRow | null;
  canary: WebhookReleaseRuntimeRow | null;
}

export interface WebhookReleaseRuntimeRow {
  id: string;
  releaseLineId: string;
  projectId: string;
  laneType: 'production' | 'canary';
  promptName: string;
  promptVersionId: string;
  promptId: string;
  modelId: string;
  inputConnectorId: string;
  trafficRatio: number | null;
  trafficMode: 'split' | 'dual_run' | null;
  variableMapping: unknown;
  filterRules: unknown;
  externalIdField: string;
  runConfig: Record<string, unknown>;
  promptBody: string;
  promptVariables: unknown;
  promptOutputSchema: unknown;
  promptJudgmentRules: unknown;
  promptLanguage: string;
}

export interface WebhookRunResultRow {
  id: string;
  createdAt: Date | string;
  status: string;
  externalId: string | null;
  renderedPrompt: unknown;
  inputVariables: unknown;
  rawResponse: string | null;
  parsedOutput: unknown;
  decisionOutput: string | null;
  expectedOutput: string | null;
  isCorrect: boolean | null;
  judgmentStatus: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  latencyMs: number | string | null;
  inputTokens: number | string | null;
  outputTokens: number | string | null;
  costEstimate: number | string | null;
}

@Injectable()
export class WebhookRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  /**
   * Locates a connector + its active webhook token in a single query via slug + pathName + token hash.
   *
   * Design:
   * - One query joins connectors with ph_core.tokens (scope='webhook' AND connector_id=c.id);
   * - token_hash must match, otherwise return null;
   * - expires_at: even when expired, return the row, and let the caller decide 401 invalid_webhook_token / expired_webhook_token;
   * - any case where the connector does not exist / the token does not match returns null; the caller uniformly throws 401 (to avoid enumeration).
   *
   * See docs/specs/03-orchestration.md §3.6 / docs/specs/06-database-schema.md §3.2.
   */
  async findConnectorWithValidToken(
    webhookSlug: string,
    pathName: string,
    tokenHash: string,
  ): Promise<WebhookConnectorTokenResult | null> {
    const rows = await this.db.execute(sql`
      SELECT
        c.id,
        c.project_id,
        c.name,
        c.config,
        c.webhook_path,
        c.ip_whitelist,
        t.id AS token_id,
        t.expires_at AS token_expires_at
      FROM ph_assets.connectors c
      INNER JOIN ph_core.tokens t
        ON t.scope = 'webhook'
       AND t.connector_id = c.id
       AND t.revoked_at IS NULL
      WHERE c.type = 'webhook'
        AND c.direction = 'input'
        AND c.deleted_at IS NULL
        AND t.token_hash = ${tokenHash}
        AND COALESCE(
          NULLIF(c.config->>'webhookSlug', ''),
          'wh-' || lower(substr(regexp_replace(COALESCE(c.webhook_path, ''), '[^a-zA-Z0-9]', '', 'g'), 1, 8))
        ) = ${webhookSlug}
        AND COALESCE(NULLIF(c.config->>'pathName', ''), '') = ${pathName}
      LIMIT 1
    `);
    const row = unwrapRows<Record<string, unknown>>(rows)[0];
    if (!row) return null;
    return {
      connector: {
        id: row['id'] as string,
        projectId: row['project_id'] as string,
        name: row['name'] as string,
        config: (row['config'] as Record<string, unknown> | null) ?? {},
        webhookPath: (row['webhook_path'] as string | null) ?? null,
        ipWhitelist: (row['ip_whitelist'] as string[] | null) ?? null,
      },
      tokenId: row['token_id'] as string,
      tokenExpiresAt: (row['token_expires_at'] as Date | string | null) ?? null,
    };
  }

  async touchTokenLastUsed(tokenId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ph_core.tokens
      SET last_used_at = NOW()
      WHERE id = ${tokenId}::uuid
    `);
  }

  async findActiveReleaseForConnector(connectorId: string): Promise<WebhookReleaseRuntimeLineRow | null> {
    const rows = await this.db.execute(sql`
      SELECT
        line.id,
        line.project_id,
        ${webhookLaneSelectSql('prod')},
        ${webhookLaneSelectSql('canary')}
      FROM ph_releases.release_lines line
      LEFT JOIN ph_releases.release_line_events prod
        ON prod.id = line.current_production_event_id
       AND prod.status = 'running'
       AND prod.lane_type = 'production'
      LEFT JOIN ph_releases.release_line_events canary
        ON canary.id = line.active_canary_event_id
       AND canary.status = 'running'
       AND canary.lane_type = 'canary'
      WHERE line.input_connector_id = ${connectorId}::uuid
        AND line.status <> 'archived'
        AND (prod.id IS NOT NULL OR canary.id IS NOT NULL)
      ORDER BY line.updated_at DESC
      LIMIT 1
    `);
    const row = unwrapRows<Record<string, unknown>>(rows)[0];
    if (!row) return null;
    return {
      id: row['id'] as string,
      projectId: row['project_id'] as string,
      production: mapWebhookLaneRow(row, 'prod'),
      canary: mapWebhookLaneRow(row, 'canary'),
    };
  }

  async incrementReceived(releaseLineEventId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ph_releases.release_line_events
      SET total_received = total_received + 1,
          updated_at = NOW()
      WHERE id = ${releaseLineEventId}::uuid
    `);
  }

  async incrementFiltered(releaseLineEventId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ph_releases.release_line_events
      SET total_filtered = total_filtered + 1,
          updated_at = NOW()
      WHERE id = ${releaseLineEventId}::uuid
    `);
  }

  async findRunResult(runResultId: string): Promise<WebhookRunResultRow | null> {
    const rows = await this.db.execute(sql`
      SELECT
        id,
        created_at,
        status,
        external_id,
        rendered_prompt,
        input_variables,
        raw_response,
        parsed_output,
        decision_output,
        expected_output,
        is_correct,
        judgment_status,
        error_class,
        error_message,
        latency_ms,
        input_tokens,
        output_tokens,
        cost_estimate
      FROM ph_runs.run_results
      WHERE id = ${runResultId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = unwrapRows<Record<string, unknown>>(rows)[0];
    if (!row) return null;
    return {
      id: row['id'] as string,
      createdAt: row['created_at'] as Date | string,
      status: row['status'] as string,
      externalId: (row['external_id'] as string | null) ?? null,
      renderedPrompt: row['rendered_prompt'],
      inputVariables: row['input_variables'],
      rawResponse: (row['raw_response'] as string | null) ?? null,
      parsedOutput: row['parsed_output'],
      decisionOutput: (row['decision_output'] as string | null) ?? null,
      expectedOutput: (row['expected_output'] as string | null) ?? null,
      isCorrect: (row['is_correct'] as boolean | null) ?? null,
      judgmentStatus: (row['judgment_status'] as string | null) ?? null,
      errorClass: (row['error_class'] as string | null) ?? null,
      errorMessage: (row['error_message'] as string | null) ?? null,
      latencyMs: (row['latency_ms'] as number | string | null) ?? null,
      inputTokens: (row['input_tokens'] as number | string | null) ?? null,
      outputTokens: (row['output_tokens'] as number | string | null) ?? null,
      costEstimate: (row['cost_estimate'] as number | string | null) ?? null,
    };
  }

  async attachResultToRelease(releaseLineEventId: string, result: WebhookRunResultRow): Promise<boolean> {
    const failedIncrement = isRunResultFailure(result.status, result.judgmentStatus, result.expectedOutput) ? 1 : 0;
    const rows = await this.db.execute(sql`
      UPDATE ph_releases.release_line_events
      SET total_processed = total_processed + 1,
          total_errors = total_errors + ${failedIncrement},
          total_correct = total_correct + CASE WHEN ${result.isCorrect} IS TRUE THEN 1 ELSE 0 END,
          updated_at = NOW()
      WHERE id = ${releaseLineEventId}::uuid
      RETURNING id
    `);
    return unwrapRows<{ id: string }>(rows).length > 0;
  }
}

function webhookLaneSelectSql(alias: 'prod' | 'canary') {
  return sql.raw(`
        ${alias}.id AS ${alias}_id,
        ${alias}.release_line_id AS ${alias}_release_line_id,
        ${alias}.project_id AS ${alias}_project_id,
        ${alias}.lane_type AS ${alias}_lane_type,
        ${alias}.prompt_name AS ${alias}_prompt_name,
        ${alias}.prompt_version_id AS ${alias}_prompt_version_id,
        ${alias}.prompt_id AS ${alias}_prompt_id,
        ${alias}.model_id AS ${alias}_model_id,
        ${alias}.input_connector_id AS ${alias}_input_connector_id,
        ${alias}.traffic_ratio AS ${alias}_traffic_ratio,
        ${alias}.traffic_mode AS ${alias}_traffic_mode,
        ${alias}.variable_mapping AS ${alias}_variable_mapping,
        ${alias}.filter_rules AS ${alias}_filter_rules,
        ${alias}.external_id_field AS ${alias}_external_id_field,
        ${alias}.run_config AS ${alias}_run_config,
        COALESCE(${alias}.prompt_version_snapshot->>'body', '') AS ${alias}_prompt_body,
        ${alias}.prompt_version_snapshot->'variables' AS ${alias}_prompt_variables,
        ${alias}.prompt_version_snapshot->'outputSchema' AS ${alias}_prompt_output_schema,
        ${alias}.prompt_version_snapshot->'judgmentRules' AS ${alias}_prompt_judgment_rules,
        COALESCE(${alias}.prompt_version_snapshot->>'promptLanguage', 'zh-CN') AS ${alias}_prompt_language
  `);
}

function mapWebhookLaneRow(row: Record<string, unknown>, prefix: 'prod' | 'canary'): WebhookReleaseRuntimeRow | null {
  const id = row[`${prefix}_id`];
  if (typeof id !== 'string') return null;
  return {
    id,
    releaseLineId: row[`${prefix}_release_line_id`] as string,
    projectId: row[`${prefix}_project_id`] as string,
    laneType: row[`${prefix}_lane_type`] as 'production' | 'canary',
    promptName: (row[`${prefix}_prompt_name`] as string | null) ?? 'release',
    promptVersionId: row[`${prefix}_prompt_version_id`] as string,
    promptId: row[`${prefix}_prompt_id`] as string,
    modelId: row[`${prefix}_model_id`] as string,
    inputConnectorId: row[`${prefix}_input_connector_id`] as string,
    trafficRatio: toNumberOrNull(row[`${prefix}_traffic_ratio`] as number | string | null),
    trafficMode: (row[`${prefix}_traffic_mode`] as 'split' | 'dual_run' | null) ?? null,
    variableMapping: row[`${prefix}_variable_mapping`],
    filterRules: row[`${prefix}_filter_rules`],
    externalIdField: (row[`${prefix}_external_id_field`] as string | null) ?? 'id',
    runConfig: (row[`${prefix}_run_config`] as Record<string, unknown> | null) ?? {},
    promptBody: (row[`${prefix}_prompt_body`] as string | null) ?? '',
    promptVariables: row[`${prefix}_prompt_variables`],
    promptOutputSchema: row[`${prefix}_prompt_output_schema`],
    promptJudgmentRules: row[`${prefix}_prompt_judgment_rules`],
    promptLanguage: (row[`${prefix}_prompt_language`] as string | null) ?? 'zh-CN',
  };
}

function unwrapRows<T = unknown>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
    return ((result as { rows?: T[] }).rows ?? []) as T[];
  }
  return [];
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}
