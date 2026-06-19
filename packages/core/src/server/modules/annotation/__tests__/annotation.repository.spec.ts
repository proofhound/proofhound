import type { DbClient } from '@proofhound/db';
import type { Query, SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { ObjectStorageProvider } from '../../../common/contracts/object-storage.provider';
import { RunResultPayloadReader } from '../../run-result/run-result-payload.reader';
import { AnnotationRepository } from '../annotation.repository';

// With object storage disabled the payload reader is a pure inline pass-through, so these
// query-shape tests keep their existing behaviour.
const passThroughReader = new RunResultPayloadReader({ isEnabled: () => false } as unknown as ObjectStorageProvider);

function makeAnnotationRepo(db: DbClient): AnnotationRepository {
  return new AnnotationRepository(db, passThroughReader);
}

const taskId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';

describe('AnnotationRepository', () => {
  it('places sample filters after run result joins when listing samples', async () => {
    let query: Query | null = null;
    const repo = makeAnnotationRepo({
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return { rows: [] };
      }),
    } as never);

    await repo.listSamples(taskId, { status: 'pending', limit: 80, offset: 0 });

    expect(query).not.toBeNull();
    expect(query!.sql).toContain(
      'FROM ph_runs.annotations annotation\n    LEFT JOIN ph_runs.run_results rr ON rr.id = annotation.run_result_id',
    );
    expect(query!.sql).toMatch(/LEFT JOIN ph_runs\.run_results rr ON rr\.id = annotation\.run_result_id\s+WHERE/);
    expect(query!.sql).not.toMatch(/WHERE annotation\.task_id = \$1::uuid\s+LEFT JOIN/);
  });

  it('derives release version category options from prompt version snapshots', async () => {
    const repo = makeAnnotationRepo({
      execute: vi.fn(async () => ({
        rows: [
          {
            release_line_id: '33333333-3333-4333-8333-333333333333',
            release_line_name: 'support-line',
            release_line_status: 'running',
            prompt_name: 'support-classifier',
            input_connector_name: 'webhook',
            release_version_id: '44444444-4444-4444-8444-444444444444',
            release_version_kind: 'production',
            release_version_production_number: 1,
            release_version_target_production_number: 1,
            release_version_candidate_number: null,
            prompt_version_id: '55555555-5555-4555-8555-555555555555',
            prompt_version_number: 2,
            prompt_version_snapshot: {
              outputSchema: {
                fields: [{ key: 'label', value: '退款 / 物流 / 其他', isJudgment: true }],
              },
            },
            model_id: '66666666-6666-4666-8666-666666666666',
            model_name: 'gpt-test',
            model_provider: 'openai',
            run_result_count: 8,
            canary_count: 3,
            online_count: 5,
            category_counts: { 退款: 2, 物流: 4 },
            journey_canary_count: 3,
            journey_online_count: 5,
          },
        ],
      })),
    } as never);

    const result = await repo.listOptions(projectId);

    expect(result[0]?.versions[0]?.categoryOptions).toEqual(['退款', '物流', '其他']);
    expect(result[0]?.versions[0]?.runResultCount).toBe(8);
    expect(result[0]?.versions[0]?.categoryCounts).toEqual([
      { category: '退款', count: 2 },
      { category: '物流', count: 4 },
      { category: '其他', count: 0 },
    ]);
  });

  it('left-joins release versions and includes null-version traffic for the journey scope', async () => {
    let query: Query | null = null;
    const repo = makeAnnotationRepo({
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return { rows: [{ total: 0 }] };
      }),
    } as never);

    await repo.countMatchingRunResults(
      projectId,
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      'journey',
      'all',
    );

    expect(query).not.toBeNull();
    // run_results detached from a specific version (release_version_id nulled by
    // a run-config / route change) must remain reachable via the event, so the
    // version table is LEFT JOINed rather than INNER JOINed.
    expect(query!.sql).toContain('LEFT JOIN ph_releases.release_versions version');
    expect(query!.sql).not.toContain('INNER JOIN ph_releases.release_versions version');
    // The non-version-scoped journey path includes those NULL-version rows.
    expect(query!.sql).toContain('version.id IS NULL');
  });

  it('restricts the exact scope to one version without including null-version traffic', async () => {
    let query: Query | null = null;
    const repo = makeAnnotationRepo({
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return { rows: [{ total: 0 }] };
      }),
    } as never);

    await repo.countMatchingRunResults(
      projectId,
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      'exact',
      'all',
    );

    expect(query).not.toBeNull();
    expect(query!.sql).toContain('LEFT JOIN ph_releases.release_versions version');
    // Version-scoped queries still restrict to the specific version; a
    // NULL-version row legitimately does not match version.id = $X.
    expect(query!.sql).toMatch(/version\.id = \$\d+::uuid/);
    expect(query!.sql).not.toContain('version.id IS NULL');
  });

  it('left-joins release versions when sampling candidates for the journey scope', async () => {
    const queries: Query[] = [];
    const repo = makeAnnotationRepo({
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          execute: vi.fn(async (sqlQuery: SQL) => {
            queries.push(toQuery(sqlQuery));
            return { rows: [{ id: taskId, inserted_count: 0 }] };
          }),
        }),
      ),
    } as never);

    await repo.createTask(
      projectId,
      {
        name: 'journey-task',
        releaseLineId: '33333333-3333-4333-8333-333333333333',
        releaseVersionId: '44444444-4444-4444-8444-444444444444',
        releaseVersionScope: 'journey',
        scope: 'all',
        samplingMode: 'random',
        sampleSize: 5,
      },
      projectId,
      5,
      ['退款', '物流'],
    );

    const candidateQuery = queries.find((query) => query.sql.includes('candidates AS'));
    expect(candidateQuery).toBeDefined();
    expect(candidateQuery!.sql).toContain('LEFT JOIN ph_releases.release_versions version');
    expect(candidateQuery!.sql).not.toContain('INNER JOIN ph_releases.release_versions version');
    expect(candidateQuery!.sql).toContain('version.id IS NULL');
  });

  it('treats journey category sets in different declaration order as compatible', async () => {
    const repo = makeAnnotationRepo({
      execute: vi.fn(async () => ({
        rows: [
          { prompt_version_snapshot: snapshotWithCategories(['退款', '物流', '其他']) },
          { prompt_version_snapshot: snapshotWithCategories(['其他', '退款', '物流']) },
        ],
      })),
    } as never);

    const result = await repo.findReleaseVersionCategoryOptions(
      projectId,
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      'journey',
    );

    expect(result.compatible).toBe(true);
    // Returned options keep the original declaration order of the first version.
    expect(result.options).toEqual(['退款', '物流', '其他']);
  });

  it('flags journey category sets with different members as incompatible', async () => {
    const repo = makeAnnotationRepo({
      execute: vi.fn(async () => ({
        rows: [
          { prompt_version_snapshot: snapshotWithCategories(['退款', '物流']) },
          { prompt_version_snapshot: snapshotWithCategories(['退款', '物流', '其他']) },
        ],
      })),
    } as never);

    const result = await repo.findReleaseVersionCategoryOptions(
      projectId,
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      'journey',
    );

    expect(result.compatible).toBe(false);
    expect(result.options).toEqual([]);
  });

  it('allows submitting unlocked or stale samples without a separate claim step', async () => {
    let query: Query | null = null;
    const repo = makeAnnotationRepo({
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return { rows: [] };
      }),
    } as never);

    await repo.submitSample(taskId, '33333333-3333-4333-8333-333333333333', projectId, {
      expectedOutput: '退款',
      notes: null,
    });

    expect(query).not.toBeNull();
    expect(query!.sql).toContain("jsonb_build_object('expected_output', $1::text)");
    expect(query!.sql).toMatch(/locked_by = \$\d+::uuid/);
    expect(query!.sql).toMatch(/annotation\.locked_by = \$\d+::uuid/);
    expect(query!.sql).toContain('annotation.locked_by IS NULL');
    expect(query!.sql).toContain("annotation.lock_heartbeat_at < NOW() - INTERVAL '5 min'");
  });
});

function snapshotWithCategories(categories: string[]): Record<string, unknown> {
  return {
    outputSchema: {
      fields: [{ key: 'label', value: categories.join(' / '), isJudgment: true }],
    },
  };
}

function toQuery(query: SQL): Query {
  return query.toQuery({
    casing: { getColumnCasing: (column: { name: string }) => column.name } as never,
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
    paramStartIndex: { value: 0 },
  });
}
