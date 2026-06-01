import type { Query, SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { AnnotationRepository } from '../annotation.repository';

const taskId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';

describe('AnnotationRepository', () => {
  it('places sample filters after run result joins when listing samples', async () => {
    let query: Query | null = null;
    const repo = new AnnotationRepository({
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

  it('derives release variant category options from prompt version snapshots', async () => {
    const repo = new AnnotationRepository({
      execute: vi.fn(async () => ({
        rows: [
          {
            release_line_id: '33333333-3333-4333-8333-333333333333',
            release_line_name: 'support-line',
            release_line_status: 'production',
            prompt_name: 'support-classifier',
            input_connector_name: 'webhook',
            release_variant_id: '44444444-4444-4444-8444-444444444444',
            variant_number: 1,
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
            canary_count: 3,
            online_count: 5,
          },
        ],
      })),
    } as never);

    const result = await repo.listOptions(projectId);

    expect(result[0]?.variants[0]?.categoryOptions).toEqual(['退款', '物流', '其他']);
  });

  it('allows submitting unlocked or stale samples without a separate claim step', async () => {
    let query: Query | null = null;
    const repo = new AnnotationRepository({
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

function toQuery(query: SQL): Query {
  return query.toQuery({
    casing: { getColumnCasing: (column: { name: string }) => column.name } as never,
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
    paramStartIndex: { value: 0 },
  });
}
