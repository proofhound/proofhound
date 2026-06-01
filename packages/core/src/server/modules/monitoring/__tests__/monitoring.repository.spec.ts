import type { Query, SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { MonitoringRepository, resolveMonitoringGranularity } from '../monitoring.repository';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const FILTER = {
  from: '2026-05-23T00:00:00.000Z',
  to: '2026-05-23T01:00:00.000Z',
  granularity: 'auto' as const,
};

describe('MonitoringRepository', () => {
  it('maps current and previous aggregate rows into KPI response shape', async () => {
    const responses = [
      [
        {
          source_bucket: 'prod',
          requests: 5,
          errors: 1,
          rpm_peak: 3,
          tpm_peak: 120,
          latency_avg_ms: 210,
          latency_p50_ms: 180,
          latency_p95_ms: 430,
          latency_p99_ms: 520,
          tokens: 400,
          cost: '0.125000',
        },
        {
          source_bucket: 'exp',
          requests: '2',
          errors: '0',
          rpm_peak: '2',
          tpm_peak: '80',
          latency_avg_ms: '310',
          latency_p50_ms: '300',
          latency_p95_ms: '500',
          latency_p99_ms: '600',
          tokens: '90',
          cost: '0.025000',
        },
        {
          source_bucket: null,
          requests: '7',
          errors: '1',
          rpm_peak: '4',
          tpm_peak: '160',
          latency_avg_ms: '238.571',
          latency_p50_ms: '220',
          latency_p95_ms: '480',
          latency_p99_ms: '590',
          tokens: '490',
          cost: '0.150000',
        },
      ],
      [
        {
          source_bucket: null,
          requests: '4',
          errors: '2',
          rpm_peak: '3',
          tpm_peak: '100',
          latency_avg_ms: '180',
          latency_p50_ms: '170',
          latency_p95_ms: '260',
          latency_p99_ms: '280',
          tokens: '300',
          cost: '0.090000',
        },
      ],
    ];
    const db = {
      execute: vi.fn(async () => ({ rows: responses.shift() ?? [] })),
    };
    const repo = new MonitoringRepository(db as never);

    const stats = await repo.getStats(PROJECT_ID, FILTER);

    expect(stats.requests).toEqual({
      total: 7,
      previous: 4,
      bySource: { prod: 5, canary: 0, iter: 0, exp: 2 },
    });
    expect(stats.errors).toEqual({
      total: 1,
      previous: 2,
      bySource: { prod: 1, canary: 0, iter: 0, exp: 0 },
    });
    expect(stats.rpmPeak.total).toBe(4);
    expect(stats.tpmPeak.bySource.exp).toBe(80);
    expect(stats.latencyAverageMs.total).toBe(238.571);
    expect(stats.latencyP95Ms.previous).toBe(260);
    expect(stats.latencyP99Ms.bySource.prod).toBe(520);
    expect(stats.tokens.total).toBe(490);
    expect(stats.cost.previous).toBe(0.09);
  });

  it('selects total latency aggregates for the stats total branch', async () => {
    const queries: Query[] = [];
    const db = {
      execute: vi.fn(async (sqlQuery: SQL) => {
        queries.push(toQuery(sqlQuery));
        return { rows: [] };
      }),
    };
    const repo = new MonitoringRepository(db as never);

    await repo.getStats(PROJECT_ID, FILTER);

    expect(queries[0]).toBeDefined();
    const totalSummarySql = queries[0]!.sql.split('total_summary AS (')[1]?.split('),\n      total_minute AS')[0];
    expect(totalSummarySql).toContain('AS latency_avg_ms');
    expect(totalSummarySql).toContain('AS latency_p50_ms');
    expect(totalSummarySql).toContain('AS latency_p95_ms');
    expect(totalSummarySql).toContain('AS latency_p99_ms');
  });

  it('maps latency series into timeseries response points', async () => {
    const db = {
      execute: vi.fn(async () => ({
        rows: [
          {
            bucket_at: '2026-05-23T00:00:00.000Z',
            source_bucket: 'canary',
            requests: '4',
            errors: '1',
            rpm: '3',
            tpm: '90',
            latency_avg_ms: '260',
            latency_p50_ms: '240',
            latency_p95_ms: '510',
            latency_p99_ms: '620',
            tokens: '300',
            cost: '0.125000',
          },
        ],
      })),
    };
    const repo = new MonitoringRepository(db as never);

    const timeseries = await repo.getTimeseries(PROJECT_ID, FILTER);

    expect(timeseries.points[0]).toMatchObject({
      bucketAt: '2026-05-23T00:00:00.000Z',
      latencyAverageMs: { canary: 260 },
      latencyP50Ms: { canary: 240 },
      latencyP95Ms: { canary: 510 },
      latencyP99Ms: { canary: 620 },
    });
  });

  it('builds filtered ranking SQL with project, prompt, model, and source constraints', async () => {
    let query: Query | null = null;
    const db = {
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return { rows: [] };
      }),
    };
    const repo = new MonitoringRepository(db as never);

    await repo.getModelRanking(
      PROJECT_ID,
      {
        ...FILTER,
        modelIds: ['11111111-1111-4111-8111-111111111111'],
        promptIds: ['22222222-2222-4222-8222-222222222222'],
        sourceIds: ['33333333-3333-4333-8333-333333333333'],
        sources: ['prod', 'iter'],
      },
      'tokens',
    );

    expect(query).not.toBeNull();
    expect(query!.sql).toContain('rr.project_id = $1::uuid');
    expect(query!.sql).toContain('rr.model_id IN');
    expect(query!.sql).toContain('pv.prompt_id IN');
    expect(query!.sql).toContain('rr.source_id IN');
    expect(query!.sql).toContain('LEFT JOIN ph_releases.release_line_events release_event');
    expect(query!.sql).toContain("rr.source = 'online'");
    expect(query!.sql).toContain("rr.source = 'release'");
    expect(query!.sql).toContain("release_event.lane_type = 'production'");
    expect(query!.sql).toContain("rr.source IN ('optimization_analysis', 'optimization_generate')");
    expect(query!.sql).toContain('ORDER BY total_tokens DESC');
  });

  it('maps release production and canary lanes into monitoring source buckets', async () => {
    const queries: Query[] = [];
    const db = {
      execute: vi.fn(async (sqlQuery: SQL) => {
        queries.push(toQuery(sqlQuery));
        return { rows: [] };
      }),
    };
    const repo = new MonitoringRepository(db as never);

    await repo.getStats(PROJECT_ID, {
      ...FILTER,
      sourceIds: ['33333333-3333-4333-8333-333333333333'],
      sources: ['prod', 'canary'],
    });

    expect(queries[0]).toBeDefined();
    expect(queries[0]!.sql).toContain('LEFT JOIN ph_releases.release_line_events release_event');
    expect(queries[0]!.sql).toContain("WHEN 'release' THEN");
    expect(queries[0]!.sql).toContain("WHEN 'production' THEN 'prod'");
    expect(queries[0]!.sql).toContain("WHEN 'canary' THEN 'canary'");
    expect(queries[0]!.sql).toContain(
      "(rr.source = 'online' OR (rr.source = 'release' AND release_event.lane_type = 'production'))",
    );
    expect(queries[0]!.sql).toContain(
      "(rr.source = 'canary' OR (rr.source = 'release' AND release_event.lane_type = 'canary'))",
    );
  });

  it('counts runtime, parsing, and applicable judge failures without treating incorrect judgments as failures', async () => {
    let query: Query | null = null;
    const db = {
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return { rows: [] };
      }),
    };
    const repo = new MonitoringRepository(db as never);

    await repo.getPromptRanking(PROJECT_ID, FILTER, 'requests');

    expect(query).not.toBeNull();
    expect(query!.sql).toContain("status <> 'success'");
    expect(query!.sql).toContain("judgment_status = 'parse_error'");
    expect(query!.sql).toContain("judgment_status = 'judge_error' AND expected_output IS NOT NULL");
    expect(query!.sql).not.toContain("'incorrect'");
  });

  it('sorts prompt ranking by failure rate when requested', async () => {
    let query: Query | null = null;
    const db = {
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return { rows: [] };
      }),
    };
    const repo = new MonitoringRepository(db as never);

    await repo.getPromptRanking(PROJECT_ID, FILTER, 'failureRate');

    expect(query).not.toBeNull();
    expect(query!.sql).toContain('ORDER BY failure_rate DESC, request_count DESC, prompt_name ASC');
  });
});

describe('resolveMonitoringGranularity', () => {
  it('keeps explicit granularity and chooses compact auto buckets', () => {
    expect(
      resolveMonitoringGranularity(
        'minute',
        new Date('2026-05-23T00:00:00.000Z'),
        new Date('2026-05-30T00:00:00.000Z'),
      ),
    ).toBe('minute');
    expect(
      resolveMonitoringGranularity('auto', new Date('2026-05-23T00:00:00.000Z'), new Date('2026-05-23T02:00:00.000Z')),
    ).toBe('minute');
    expect(
      resolveMonitoringGranularity('auto', new Date('2026-05-16T00:00:00.000Z'), new Date('2026-05-23T00:00:00.000Z')),
    ).toBe('day');
    expect(
      resolveMonitoringGranularity('auto', new Date('2026-04-23T00:00:00.000Z'), new Date('2026-05-23T00:00:00.000Z')),
    ).toBe('day');
  });
});

function toQuery(query: SQL): Query {
  return query.toQuery({
    casing: {} as never,
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
    paramStartIndex: { value: 0 },
  });
}
