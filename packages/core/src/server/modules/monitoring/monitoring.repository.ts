import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '@proofhound/db';
import {
  SOURCE_BUCKETS,
  type ModelMonitoringRankingResponseDto,
  type MonitoringGranularity,
  type ProjectMonitoringFilterDto,
  type ProjectMonitoringStatsDto,
  type ProjectMonitoringTimeseriesDto,
  type SourceBucket,
  type SourceBucketValuesDto,
  type PromptMonitoringRankingResponseDto,
} from '@proofhound/shared';
import { sql, type SQL } from 'drizzle-orm';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

type ResolvedGranularity = Exclude<MonitoringGranularity, 'auto'>;

interface AggregateRow {
  source_bucket: SourceBucket | null;
  requests: number | string | null;
  errors: number | string | null;
  rpm_peak: number | string | null;
  tpm_peak: number | string | null;
  latency_avg_ms: number | string | null;
  latency_p50_ms: number | string | null;
  latency_p95_ms: number | string | null;
  latency_p99_ms: number | string | null;
  tokens: number | string | null;
  cost: number | string | null;
}

interface TimeseriesRow {
  bucket_at: string | Date;
  source_bucket: SourceBucket | null;
  requests: number | string | null;
  errors: number | string | null;
  rpm: number | string | null;
  tpm: number | string | null;
  latency_avg_ms: number | string | null;
  latency_p50_ms: number | string | null;
  latency_p95_ms: number | string | null;
  latency_p99_ms: number | string | null;
  tokens: number | string | null;
  cost: number | string | null;
}

interface PromptRankingRow {
  prompt_id: string;
  prompt_name: string;
  latest_version_number: number | string | null;
  version_count: number | string | null;
  request_count: number | string | null;
  total_request_count: number | string | null;
  cost_estimate: number | string | null;
  failure_rate: number | string | null;
  hit_rate: number | string | null;
}

interface ModelRankingRow {
  model_id: string;
  model_name: string;
  provider_type: string;
  provider_model_id: string;
  request_count: number | string | null;
  total_tokens: number | string | null;
  cost_estimate: number | string | null;
  capacity_used_ratio: number | string | null;
  rpm_limit: number | string | null;
}

const EMPTY_BY_SOURCE: SourceBucketValuesDto = Object.freeze({ prod: 0, canary: 0, iter: 0, exp: 0 });
const RANKING_LIMIT = 20;

@Injectable()
export class MonitoringRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  async getStats(projectId: string, filter: ProjectMonitoringFilterDto): Promise<ProjectMonitoringStatsDto> {
    const from = new Date(filter.from);
    const to = new Date(filter.to);
    const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

    const [currentRows, previousRows] = await Promise.all([
      this.aggregateWindow(projectId, filter, from, to),
      this.aggregateWindow(projectId, filter, previousFrom, from),
    ]);

    const current = toAggregateSummary(currentRows);
    const previous = toAggregateSummary(previousRows);

    return {
      requests: toKpi(current.requests.total, previous.requests.total, current.requests.bySource),
      errors: toKpi(current.errors.total, previous.errors.total, current.errors.bySource),
      rpmPeak: toKpi(current.rpmPeak.total, previous.rpmPeak.total, current.rpmPeak.bySource),
      tpmPeak: toKpi(current.tpmPeak.total, previous.tpmPeak.total, current.tpmPeak.bySource),
      latencyAverageMs: toKpi(
        current.latencyAverageMs.total,
        previous.latencyAverageMs.total,
        current.latencyAverageMs.bySource,
      ),
      latencyP50Ms: toKpi(current.latencyP50Ms.total, previous.latencyP50Ms.total, current.latencyP50Ms.bySource),
      latencyP95Ms: toKpi(current.latencyP95Ms.total, previous.latencyP95Ms.total, current.latencyP95Ms.bySource),
      latencyP99Ms: toKpi(current.latencyP99Ms.total, previous.latencyP99Ms.total, current.latencyP99Ms.bySource),
      tokens: toKpi(current.tokens.total, previous.tokens.total, current.tokens.bySource),
      cost: toKpi(current.cost.total, previous.cost.total, current.cost.bySource),
    };
  }

  async getTimeseries(projectId: string, filter: ProjectMonitoringFilterDto): Promise<ProjectMonitoringTimeseriesDto> {
    const from = new Date(filter.from);
    const to = new Date(filter.to);
    const granularity = resolveMonitoringGranularity(filter.granularity, from, to);
    const conditions = buildRunResultConditions(projectId, filter, from, to);
    const whereSql = sql.join(conditions, sql` AND `);
    const intervalSql = intervalForGranularity(granularity);

    const result: unknown = await this.db.execute(sql`
      WITH buckets AS (
        SELECT generate_series(
          date_trunc(${granularity}, ${from.toISOString()}::timestamptz),
          date_trunc(${granularity}, (${to.toISOString()}::timestamptz - interval '1 millisecond')),
          ${intervalSql}
        ) AS bucket_at
      ),
      filtered AS (
        SELECT
          date_trunc(${granularity}, rr.created_at) AS bucket_at,
          date_trunc('minute', rr.created_at) AS minute_at,
          ${sourceBucketSql()} AS source_bucket,
          rr.status,
          rr.judgment_status,
          rr.expected_output,
          rr.latency_ms,
          (COALESCE(rr.input_tokens, 0) + COALESCE(rr.output_tokens, 0))::numeric AS tokens,
          COALESCE(rr.cost_estimate, 0)::numeric AS cost
        FROM ph_runs.run_results rr
        LEFT JOIN ph_assets.prompt_versions pv ON pv.id = rr.prompt_version_id
        LEFT JOIN ph_releases.release_line_events release_event
          ON release_event.id = rr.source_id
         AND release_event.project_id = rr.project_id
        WHERE ${whereSql}
      ),
      metric_agg AS (
        SELECT
          bucket_at,
          source_bucket,
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (WHERE ${runFailureSql()})::int AS errors,
          COALESCE(AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_avg_ms,
          COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_p50_ms,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_p95_ms,
          COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_p99_ms,
          COALESCE(SUM(tokens), 0)::numeric AS tokens,
          COALESCE(SUM(cost), 0)::numeric AS cost
        FROM filtered
        GROUP BY bucket_at, source_bucket
      ),
      minute_agg AS (
        SELECT
          bucket_at,
          source_bucket,
          minute_at,
          COUNT(*)::int AS request_count,
          COALESCE(SUM(tokens), 0)::numeric AS token_count
        FROM filtered
        GROUP BY bucket_at, source_bucket, minute_at
      ),
      peak_agg AS (
        SELECT
          bucket_at,
          source_bucket,
          COALESCE(MAX(request_count), 0)::numeric AS rpm,
          COALESCE(MAX(token_count), 0)::numeric AS tpm
        FROM minute_agg
        GROUP BY bucket_at, source_bucket
      )
      SELECT
        b.bucket_at,
        m.source_bucket,
        COALESCE(m.requests, 0)::int AS requests,
        COALESCE(m.errors, 0)::int AS errors,
        COALESCE(p.rpm, 0)::numeric AS rpm,
        COALESCE(p.tpm, 0)::numeric AS tpm,
        COALESCE(m.latency_avg_ms, 0)::numeric AS latency_avg_ms,
        COALESCE(m.latency_p50_ms, 0)::numeric AS latency_p50_ms,
        COALESCE(m.latency_p95_ms, 0)::numeric AS latency_p95_ms,
        COALESCE(m.latency_p99_ms, 0)::numeric AS latency_p99_ms,
        COALESCE(m.tokens, 0)::numeric AS tokens,
        COALESCE(m.cost, 0)::numeric AS cost
      FROM buckets b
      LEFT JOIN metric_agg m ON m.bucket_at = b.bucket_at
      LEFT JOIN peak_agg p ON p.bucket_at = m.bucket_at AND p.source_bucket = m.source_bucket
      ORDER BY b.bucket_at ASC
    `);

    return {
      granularity,
      points: toTimeseriesPoints(unwrapRows<TimeseriesRow>(result)),
    };
  }

  async getPromptRanking(
    projectId: string,
    filter: ProjectMonitoringFilterDto,
    sortBy: PromptMonitoringRankingResponseDto['sortBy'],
  ): Promise<PromptMonitoringRankingResponseDto> {
    const from = new Date(filter.from);
    const to = new Date(filter.to);
    const conditions = buildRunResultConditions(projectId, filter, from, to);
    const whereSql = sql.join(conditions, sql` AND `);
    const orderSql =
      sortBy === 'cost'
        ? sql`cost_estimate DESC, request_count DESC, prompt_name ASC`
        : sortBy === 'failureRate'
          ? sql`failure_rate DESC, request_count DESC, prompt_name ASC`
          : sql`request_count DESC, cost_estimate DESC, prompt_name ASC`;

    const result: unknown = await this.db.execute(sql`
      WITH filtered AS (
        SELECT
          pv.prompt_id,
          rr.status,
          rr.is_correct,
          rr.judgment_status,
          rr.expected_output,
          COALESCE(rr.cost_estimate, 0)::numeric AS cost
        FROM ph_runs.run_results rr
        LEFT JOIN ph_assets.prompt_versions pv ON pv.id = rr.prompt_version_id
        LEFT JOIN ph_releases.release_line_events release_event
          ON release_event.id = rr.source_id
         AND release_event.project_id = rr.project_id
        WHERE ${whereSql}
          AND pv.prompt_id IS NOT NULL
      ),
      prompt_runs AS (
        SELECT
          prompt_id,
          COUNT(*)::int AS request_count,
          COALESCE(SUM(cost), 0)::numeric AS cost_estimate,
          CASE WHEN COUNT(*) = 0
            THEN 0
            ELSE (COUNT(*) FILTER (WHERE ${runFailureSql()}))::numeric / COUNT(*)::numeric
          END AS failure_rate,
          AVG(CASE WHEN is_correct IS TRUE THEN 1.0 WHEN is_correct IS FALSE THEN 0.0 ELSE NULL END) AS hit_rate
        FROM filtered
        GROUP BY prompt_id
      ),
      version_summary AS (
        SELECT
          prompt_id,
          MAX(version_number)::int AS latest_version_number,
          COUNT(*)::int AS version_count
        FROM ph_assets.prompt_versions
        GROUP BY prompt_id
      ),
      ranked AS (
        SELECT
          p.id AS prompt_id,
          p.name AS prompt_name,
          vs.latest_version_number,
          COALESCE(vs.version_count, 0)::int AS version_count,
          pr.request_count,
          SUM(pr.request_count) OVER ()::int AS total_request_count,
          pr.cost_estimate,
          pr.failure_rate,
          pr.hit_rate
        FROM prompt_runs pr
        INNER JOIN ph_assets.prompts p ON p.id = pr.prompt_id
        LEFT JOIN version_summary vs ON vs.prompt_id = p.id
        WHERE p.project_id = ${projectId}::uuid
          AND p.deleted_at IS NULL
      )
      SELECT *
      FROM ranked
      ORDER BY ${orderSql}
      LIMIT ${RANKING_LIMIT}
    `);

    return {
      sortBy,
      items: unwrapRows<PromptRankingRow>(result).map(toPromptRankingItem),
    };
  }

  async getModelRanking(
    projectId: string,
    filter: ProjectMonitoringFilterDto,
    sortBy: ModelMonitoringRankingResponseDto['sortBy'],
  ): Promise<ModelMonitoringRankingResponseDto> {
    const from = new Date(filter.from);
    const to = new Date(filter.to);
    const conditions = buildRunResultConditions(projectId, filter, from, to);
    const whereSql = sql.join(conditions, sql` AND `);
    const orderSql =
      sortBy === 'tokens'
        ? sql`total_tokens DESC, request_count DESC, model_name ASC`
        : sortBy === 'cost'
          ? sql`cost_estimate DESC, request_count DESC, model_name ASC`
          : sql`request_count DESC, total_tokens DESC, model_name ASC`;

    const result: unknown = await this.db.execute(sql`
      WITH filtered AS (
        SELECT
          rr.model_id,
          date_trunc('minute', rr.created_at) AS minute_at,
          (COALESCE(rr.input_tokens, 0) + COALESCE(rr.output_tokens, 0))::numeric AS tokens,
          COALESCE(rr.cost_estimate, 0)::numeric AS cost
        FROM ph_runs.run_results rr
        LEFT JOIN ph_assets.prompt_versions pv ON pv.id = rr.prompt_version_id
        LEFT JOIN ph_releases.release_line_events release_event
          ON release_event.id = rr.source_id
         AND release_event.project_id = rr.project_id
        WHERE ${whereSql}
      ),
      model_runs AS (
        SELECT
          model_id,
          COUNT(*)::int AS request_count,
          COALESCE(SUM(tokens), 0)::numeric AS total_tokens,
          COALESCE(SUM(cost), 0)::numeric AS cost_estimate
        FROM filtered
        GROUP BY model_id
      ),
      minute_runs AS (
        SELECT
          model_id,
          minute_at,
          COUNT(*)::int AS request_count
        FROM filtered
        GROUP BY model_id, minute_at
      ),
      model_peaks AS (
        SELECT
          model_id,
          COALESCE(MAX(request_count), 0)::numeric AS rpm_peak
        FROM minute_runs
        GROUP BY model_id
      )
      SELECT
        m.id AS model_id,
        m.name AS model_name,
        m.provider_type,
        m.provider_model_id,
        mr.request_count,
        mr.total_tokens,
        mr.cost_estimate,
        CASE WHEN m.rpm_limit > 0
          THEN COALESCE(mp.rpm_peak, 0)::numeric / m.rpm_limit::numeric
          ELSE NULL
        END AS capacity_used_ratio,
        m.rpm_limit
      FROM model_runs mr
      INNER JOIN ph_assets.models m ON m.id = mr.model_id
      LEFT JOIN model_peaks mp ON mp.model_id = mr.model_id
      WHERE m.project_id = ${projectId}::uuid
        AND m.deleted_at IS NULL
      ORDER BY ${orderSql}
      LIMIT ${RANKING_LIMIT}
    `);

    return {
      sortBy,
      items: unwrapRows<ModelRankingRow>(result).map(toModelRankingItem),
    };
  }

  private async aggregateWindow(
    projectId: string,
    filter: ProjectMonitoringFilterDto,
    from: Date,
    to: Date,
  ): Promise<AggregateRow[]> {
    const conditions = buildRunResultConditions(projectId, filter, from, to);
    const whereSql = sql.join(conditions, sql` AND `);

    const result: unknown = await this.db.execute(sql`
      WITH filtered AS (
        SELECT
          rr.created_at,
          date_trunc('minute', rr.created_at) AS minute_at,
          ${sourceBucketSql()} AS source_bucket,
          rr.status,
          rr.judgment_status,
          rr.expected_output,
          rr.latency_ms,
          (COALESCE(rr.input_tokens, 0) + COALESCE(rr.output_tokens, 0))::numeric AS tokens,
          COALESCE(rr.cost_estimate, 0)::numeric AS cost
        FROM ph_runs.run_results rr
        LEFT JOIN ph_assets.prompt_versions pv ON pv.id = rr.prompt_version_id
        LEFT JOIN ph_releases.release_line_events release_event
          ON release_event.id = rr.source_id
         AND release_event.project_id = rr.project_id
        WHERE ${whereSql}
      ),
      source_totals AS (
        SELECT
          source_bucket,
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (WHERE ${runFailureSql()})::int AS errors,
          COALESCE(AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_avg_ms,
          COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_p50_ms,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_p95_ms,
          COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_p99_ms,
          COALESCE(SUM(tokens), 0)::numeric AS tokens,
          COALESCE(SUM(cost), 0)::numeric AS cost
        FROM filtered
        GROUP BY source_bucket
      ),
      source_minute AS (
        SELECT
          source_bucket,
          minute_at,
          COUNT(*)::int AS request_count,
          COALESCE(SUM(tokens), 0)::numeric AS token_count
        FROM filtered
        GROUP BY source_bucket, minute_at
      ),
      source_peaks AS (
        SELECT
          source_bucket,
          COALESCE(MAX(request_count), 0)::numeric AS rpm_peak,
          COALESCE(MAX(token_count), 0)::numeric AS tpm_peak
        FROM source_minute
        GROUP BY source_bucket
      ),
      total_summary AS (
        SELECT
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (WHERE ${runFailureSql()})::int AS errors,
          COALESCE(AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_avg_ms,
          COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_p50_ms,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_p95_ms,
          COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL), 0)::numeric AS latency_p99_ms,
          COALESCE(SUM(tokens), 0)::numeric AS tokens,
          COALESCE(SUM(cost), 0)::numeric AS cost
        FROM filtered
      ),
      total_minute AS (
        SELECT
          minute_at,
          COUNT(*)::int AS request_count,
          COALESCE(SUM(tokens), 0)::numeric AS token_count
        FROM filtered
        GROUP BY minute_at
      ),
      total_peaks AS (
        SELECT
          COALESCE(MAX(request_count), 0)::numeric AS rpm_peak,
          COALESCE(MAX(token_count), 0)::numeric AS tpm_peak
        FROM total_minute
      )
      SELECT
        st.source_bucket,
        st.requests,
        st.errors,
        COALESCE(sp.rpm_peak, 0)::numeric AS rpm_peak,
        COALESCE(sp.tpm_peak, 0)::numeric AS tpm_peak,
        st.latency_avg_ms,
        st.latency_p50_ms,
        st.latency_p95_ms,
        st.latency_p99_ms,
        st.tokens,
        st.cost
      FROM source_totals st
      LEFT JOIN source_peaks sp ON sp.source_bucket = st.source_bucket
      UNION ALL
      SELECT
        NULL AS source_bucket,
        ts.requests,
        ts.errors,
        COALESCE(tp.rpm_peak, 0)::numeric AS rpm_peak,
        COALESCE(tp.tpm_peak, 0)::numeric AS tpm_peak,
        ts.latency_avg_ms,
        ts.latency_p50_ms,
        ts.latency_p95_ms,
        ts.latency_p99_ms,
        ts.tokens,
        ts.cost
      FROM total_summary ts
      CROSS JOIN total_peaks tp
    `);

    return unwrapRows<AggregateRow>(result);
  }
}

export function resolveMonitoringGranularity(
  requested: MonitoringGranularity,
  from: Date,
  to: Date,
): ResolvedGranularity {
  if (requested !== 'auto') return requested;

  const durationMs = Math.max(0, to.getTime() - from.getTime());
  if (durationMs <= 6 * 60 * 60_000) return 'minute';
  if (durationMs <= 36 * 60 * 60_000) return 'hour';
  return 'day';
}

function buildRunResultConditions(projectId: string, filter: ProjectMonitoringFilterDto, from: Date, to: Date): SQL[] {
  const conditions: SQL[] = [
    sql`rr.project_id = ${projectId}::uuid`,
    sql`rr.created_at >= ${from.toISOString()}::timestamptz`,
    sql`rr.created_at < ${to.toISOString()}::timestamptz`,
  ];

  if (filter.modelIds?.length) {
    conditions.push(sql`rr.model_id IN (${uuidList(filter.modelIds)})`);
  }

  if (filter.promptVersionIds?.length) {
    conditions.push(sql`rr.prompt_version_id IN (${uuidList(filter.promptVersionIds)})`);
  }

  if (filter.promptIds?.length) {
    conditions.push(sql`pv.prompt_id IN (${uuidList(filter.promptIds)})`);
  }

  if (filter.sourceIds?.length) {
    conditions.push(sql`rr.source_id IN (${uuidList(filter.sourceIds)})`);
  }

  if (filter.sources?.length) {
    conditions.push(sourceFilterSql(filter.sources));
  }

  return conditions;
}

function sourceBucketSql(): SQL {
  return sql`
    CASE rr.source
      WHEN 'online' THEN 'prod'
      WHEN 'canary' THEN 'canary'
      WHEN 'optimization_analysis' THEN 'iter'
      WHEN 'optimization_generate' THEN 'iter'
      WHEN 'experiment' THEN 'exp'
      WHEN 'release' THEN
        CASE release_event.lane_type
          WHEN 'production' THEN 'prod'
          WHEN 'canary' THEN 'canary'
        END
    END
  `;
}

function sourceFilterSql(sources: readonly SourceBucket[]): SQL {
  const uniqueSources = [...new Set(sources)];
  return sql`(${sql.join(uniqueSources.map(sourceBucketPredicateSql), sql` OR `)})`;
}

function sourceBucketPredicateSql(source: SourceBucket): SQL {
  switch (source) {
    case 'prod':
      return sql`(rr.source = 'online' OR (rr.source = 'release' AND release_event.lane_type = 'production'))`;
    case 'canary':
      return sql`(rr.source = 'canary' OR (rr.source = 'release' AND release_event.lane_type = 'canary'))`;
    case 'iter':
      return sql`rr.source IN ('optimization_analysis', 'optimization_generate')`;
    case 'exp':
      return sql`rr.source = 'experiment'`;
  }
}

function runFailureSql(): SQL {
  return sql`
    status = 'failed'
    OR judgment_status = 'parse_error'
    OR (judgment_status = 'judge_error' AND expected_output IS NOT NULL)
  `;
}

function intervalForGranularity(granularity: ResolvedGranularity): SQL {
  switch (granularity) {
    case 'minute':
      return sql`interval '1 minute'`;
    case 'hour':
      return sql`interval '1 hour'`;
    case 'day':
      return sql`interval '1 day'`;
  }
}

function uuidList(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

function toAggregateSummary(rows: AggregateRow[]) {
  const summary = {
    requests: metricSummary(),
    errors: metricSummary(),
    rpmPeak: metricSummary(),
    tpmPeak: metricSummary(),
    latencyAverageMs: metricSummary(),
    latencyP50Ms: metricSummary(),
    latencyP95Ms: metricSummary(),
    latencyP99Ms: metricSummary(),
    tokens: metricSummary(),
    cost: metricSummary(),
  };

  for (const row of rows) {
    const target =
      row.source_bucket && isSourceBucket(row.source_bucket) ? (row.source_bucket satisfies SourceBucket) : null;

    if (target) {
      summary.requests.bySource[target] = toNumber(row.requests);
      summary.errors.bySource[target] = toNumber(row.errors);
      summary.rpmPeak.bySource[target] = toNumber(row.rpm_peak);
      summary.tpmPeak.bySource[target] = toNumber(row.tpm_peak);
      summary.latencyAverageMs.bySource[target] = toNumber(row.latency_avg_ms);
      summary.latencyP50Ms.bySource[target] = toNumber(row.latency_p50_ms);
      summary.latencyP95Ms.bySource[target] = toNumber(row.latency_p95_ms);
      summary.latencyP99Ms.bySource[target] = toNumber(row.latency_p99_ms);
      summary.tokens.bySource[target] = toNumber(row.tokens);
      summary.cost.bySource[target] = toNumber(row.cost);
      continue;
    }

    summary.requests.total = toNumber(row.requests);
    summary.errors.total = toNumber(row.errors);
    summary.rpmPeak.total = toNumber(row.rpm_peak);
    summary.tpmPeak.total = toNumber(row.tpm_peak);
    summary.latencyAverageMs.total = toNumber(row.latency_avg_ms);
    summary.latencyP50Ms.total = toNumber(row.latency_p50_ms);
    summary.latencyP95Ms.total = toNumber(row.latency_p95_ms);
    summary.latencyP99Ms.total = toNumber(row.latency_p99_ms);
    summary.tokens.total = toNumber(row.tokens);
    summary.cost.total = toNumber(row.cost);
  }

  return summary;
}

function metricSummary() {
  return { total: 0, bySource: { ...EMPTY_BY_SOURCE } };
}

function toKpi(total: number, previous: number, bySource: SourceBucketValuesDto) {
  return { total, previous, bySource };
}

function toTimeseriesPoints(rows: TimeseriesRow[]): ProjectMonitoringTimeseriesDto['points'] {
  const points = new Map<string, ProjectMonitoringTimeseriesDto['points'][number]>();

  for (const row of rows) {
    const bucketAt = toIsoString(row.bucket_at);
    const existing = points.get(bucketAt) ?? {
      bucketAt,
      requests: { ...EMPTY_BY_SOURCE },
      errors: { ...EMPTY_BY_SOURCE },
      rpm: { ...EMPTY_BY_SOURCE },
      tpm: { ...EMPTY_BY_SOURCE },
      latencyAverageMs: { ...EMPTY_BY_SOURCE },
      latencyP50Ms: { ...EMPTY_BY_SOURCE },
      latencyP95Ms: { ...EMPTY_BY_SOURCE },
      latencyP99Ms: { ...EMPTY_BY_SOURCE },
      tokens: { ...EMPTY_BY_SOURCE },
      cost: { ...EMPTY_BY_SOURCE },
    };

    if (row.source_bucket && isSourceBucket(row.source_bucket)) {
      const bucket = row.source_bucket;
      existing.requests[bucket] = toNumber(row.requests);
      existing.errors[bucket] = toNumber(row.errors);
      existing.rpm[bucket] = toNumber(row.rpm);
      existing.tpm[bucket] = toNumber(row.tpm);
      existing.latencyAverageMs[bucket] = toNumber(row.latency_avg_ms);
      existing.latencyP50Ms[bucket] = toNumber(row.latency_p50_ms);
      existing.latencyP95Ms[bucket] = toNumber(row.latency_p95_ms);
      existing.latencyP99Ms[bucket] = toNumber(row.latency_p99_ms);
      existing.tokens[bucket] = toNumber(row.tokens);
      existing.cost[bucket] = toNumber(row.cost);
    }

    points.set(bucketAt, existing);
  }

  return [...points.values()];
}

function toPromptRankingItem(row: PromptRankingRow): PromptMonitoringRankingResponseDto['items'][number] {
  const requestCount = toNumber(row.request_count);
  const totalRequestCount = toNumber(row.total_request_count);

  return {
    promptId: row.prompt_id,
    promptName: row.prompt_name,
    latestVersionNumber: row.latest_version_number === null ? null : Math.trunc(toNumber(row.latest_version_number)),
    versionCount: Math.trunc(toNumber(row.version_count)),
    requestCount,
    shareRatio: totalRequestCount > 0 ? requestCount / totalRequestCount : 0,
    costEstimate: toNumber(row.cost_estimate),
    failureRate: toNumber(row.failure_rate),
    hitRate: row.hit_rate === null ? null : toNumber(row.hit_rate),
  };
}

function toModelRankingItem(row: ModelRankingRow): ModelMonitoringRankingResponseDto['items'][number] {
  return {
    modelId: row.model_id,
    modelName: row.model_name,
    providerType: row.provider_type,
    providerModelId: row.provider_model_id,
    requestCount: Math.trunc(toNumber(row.request_count)),
    totalTokens: Math.trunc(toNumber(row.total_tokens)),
    costEstimate: toNumber(row.cost_estimate),
    capacityUsedRatio: row.capacity_used_ratio === null ? null : toNumber(row.capacity_used_ratio),
    rpmLimit: Math.trunc(toNumber(row.rpm_limit)),
  };
}

function unwrapRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isSourceBucket(value: string): value is SourceBucket {
  return (SOURCE_BUCKETS as readonly string[]).includes(value);
}
