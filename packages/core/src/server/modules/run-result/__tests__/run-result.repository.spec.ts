import type { DbClient } from '@proofhound/db';
import type { RunResultListQueryDto, RunResultReleaseListQueryDto } from '@proofhound/shared';
import type { Query, SQL } from 'drizzle-orm';
import { RunResultRepository } from '../run-result.repository';

function fakeDb(rows: Array<Record<string, unknown>> | { rows: Array<Record<string, unknown>> }): DbClient {
  return {
    execute: async () => rows as unknown,
  } as unknown as DbClient;
}

function dbSequence(...results: Array<Array<Record<string, unknown>>>): DbClient {
  const queue = [...results];
  return {
    execute: async () => {
      const next = queue.shift();
      return (next ?? []) as unknown;
    },
  } as unknown as DbClient;
}

const defaultQuery: RunResultListQueryDto = {
  page: 1,
  pageSize: 20,
  sort: 'created_desc',
} as RunResultListQueryDto;
const defaultReleaseQuery = {
  ...defaultQuery,
  sourceIds: ['55555555-5555-4555-8555-555555555555'],
  promptVersionIds: ['66666666-6666-4666-8666-666666666666'],
  lane: ['production'],
} as RunResultReleaseListQueryDto;

describe('RunResultRepository', () => {
  describe('aggregateExperiment', () => {
    it('maps snake_case SQL output to ClassificationAggregateRow', async () => {
      const repo = new RunResultRepository(
        fakeDb([
          {
            decision_output: 'positive',
            expected_output: 'positive',
            judgment_status: 'correct',
            status: 'success',
            count: '5',
            input_tokens: 100,
            output_tokens: 20,
            cost_estimate: '0.005',
          },
          {
            decision_output: null,
            expected_output: 'positive',
            judgment_status: null,
            status: 'error',
            count: 1,
            input_tokens: 0,
            output_tokens: null,
            cost_estimate: null,
          },
        ]),
      );

      const rows = await repo.aggregateExperiment('11111111-1111-1111-1111-111111111111');
      expect(rows).toEqual([
        {
          decisionOutput: 'positive',
          expectedOutput: 'positive',
          judgmentStatus: 'correct',
          status: 'success',
          count: 5,
          inputTokens: 100,
          outputTokens: 20,
          costEstimate: 0.005,
        },
        {
          decisionOutput: null,
          expectedOutput: 'positive',
          judgmentStatus: null,
          status: 'error',
          count: 1,
          inputTokens: 0,
          outputTokens: 0,
          costEstimate: 0,
        },
      ]);
    });

    it('supports node-postgres style result with .rows property', async () => {
      const repo = new RunResultRepository(
        fakeDb({
          rows: [
            {
              decision_output: 'A',
              expected_output: 'A',
              judgment_status: 'correct',
              status: 'success',
              count: 3,
              input_tokens: 10,
              output_tokens: 5,
              cost_estimate: 0.01,
            },
          ],
        }),
      );
      const rows = await repo.aggregateExperiment('22222222-2222-2222-2222-222222222222');
      expect(rows[0]?.decisionOutput).toBe('A');
      expect(rows[0]?.count).toBe(3);
    });
  });

  describe('aggregateExperimentLatency', () => {
    it('parses numeric latency aggregates from SQL row', async () => {
      const repo = new RunResultRepository(fakeDb([{ avg_ms: '1234.5', p50_ms: '1000', p95_ms: '4321' }]));
      const result = await repo.aggregateExperimentLatency('11111111-1111-1111-1111-111111111111');
      expect(result).toEqual({ averageMs: 1234.5, p50Ms: 1000, p95Ms: 4321 });
    });

    it('returns null fields when SQL returns nothing', async () => {
      const repo = new RunResultRepository(fakeDb([]));
      const result = await repo.aggregateExperimentLatency('11111111-1111-1111-1111-111111111111');
      expect(result).toEqual({ averageMs: null, p50Ms: null, p95Ms: null });
    });
  });

  describe('countBatchTerminal', () => {
    it('short-circuits when ids list is empty without DB call', async () => {
      let executeCalls = 0;
      const repo = new RunResultRepository({
        execute: async () => {
          executeCalls += 1;
          return [];
        },
      } as unknown as DbClient);

      const result = await repo.countBatchTerminal('11111111-1111-1111-1111-111111111111', []);
      expect(result).toEqual({ terminalCount: 0, failedCount: 0 });
      expect(executeCalls).toBe(0);
    });

    it('parses terminal counts from SQL row', async () => {
      let query: Query | null = null;
      const repo = new RunResultRepository({
        execute: async (sqlQuery: SQL) => {
          query = toQuery(sqlQuery);
          return [{ terminal_count: '10', failed_count: '4' }];
        },
      } as unknown as DbClient);
      const result = await repo.countBatchTerminal('11111111-1111-1111-1111-111111111111', [
        '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444',
      ]);
      expect(result).toEqual({ terminalCount: 10, failedCount: 4 });
      expect(query).not.toBeNull();
      expect(query!.sql).toContain("status <> 'success'");
      expect(query!.sql).toContain("judgment_status = 'parse_error'");
      expect(query!.sql).toContain("judgment_status = 'judge_error' AND expected_output IS NOT NULL");
    });
  });

  describe('listByExperiment', () => {
    it('maps DB rows to RunResultListItemDto and returns pagination metadata', async () => {
      const repo = new RunResultRepository(
        dbSequence(
          [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              source_id: '11111111-1111-1111-1111-111111111111',
              sample_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              external_id: null,
              status: 'success',
              judgment_status: 'correct',
              is_correct: true,
              decision_output: 'positive',
              expected_output: 'positive',
              sample_data: {
                text: 'hello from dataset',
                screenshot_image: 'https://example.test/a.png',
                label: 'positive',
              },
              dataset_field_schema: [
                { name: 'text', role: 'text', type: 'string' },
                { name: 'screenshot_image', role: 'image_url', type: 'string' },
                { name: 'label', role: 'expected_output', type: 'string' },
              ],
              input_variables: { text: 'hello', screenshot_image: 'https://example.test/a.png' },
              raw_response: '{"label":"positive"}',
              parsed_output: { label: 'positive' },
              error_class: null,
              error_message: null,
              latency_ms: 1234,
              input_tokens: '100',
              output_tokens: 25,
              cost_estimate: '0.012',
              attempt: 1,
              created_at: '2026-05-19T10:00:00.000Z',
            },
          ],
          [{ total: '57' }],
        ),
      );

      const out = await repo.listByExperiment('11111111-1111-1111-1111-111111111111', defaultQuery);
      expect(out.total).toBe(57);
      expect(out.data).toHaveLength(1);
      expect(out.data[0]).toMatchObject({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        experimentId: '11111111-1111-1111-1111-111111111111',
        status: 'success',
        judgmentStatus: 'correct',
        isCorrect: true,
        decisionOutput: 'positive',
        datasetTextFields: [{ name: 'text', role: 'text', value: 'hello from dataset' }],
        datasetImageFields: [{ name: 'screenshot_image', role: 'image_url', value: 'https://example.test/a.png' }],
        inputVariables: { text: 'hello', screenshot_image: 'https://example.test/a.png' },
        rawResponse: '{"label":"positive"}',
        parsedOutput: { label: 'positive' },
        latencyMs: 1234,
        inputTokens: 100,
        outputTokens: 25,
        costEstimate: 0.012,
        attempt: 1,
      });
      expect(out.page).toBe(1);
      expect(out.pageSize).toBe(20);
    });

    it('returns zero total and empty data when no rows', async () => {
      const repo = new RunResultRepository(dbSequence([], [{ total: 0 }]));
      const out = await repo.listByExperiment('11111111-1111-1111-1111-111111111111', defaultQuery);
      expect(out.data).toEqual([]);
      expect(out.total).toBe(0);
    });
  });

  describe('listByRelease', () => {
    it('maps production / canary rows and keeps the project boundary in SQL', async () => {
      const queue: Array<Array<Record<string, unknown>>> = [
        [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            project_id: '11111111-1111-4111-8111-111111111111',
            source: 'release',
            source_id: '55555555-5555-4555-8555-555555555555',
            release_event_id: '55555555-5555-4555-8555-555555555555',
            lane_type: 'production',
            external_id: 'order-1',
            prompt_version_id: '66666666-6666-4666-8666-666666666666',
            prompt_version_number: '3',
            model_id: '77777777-7777-4777-8777-777777777777',
            status: 'success',
            judgment_status: 'correct',
            is_correct: true,
            decision_output: 'approve',
            input_variables: { id: 'order-1' },
            raw_response: '{"decision":"approve"}',
            parsed_output: { decision: 'approve' },
            error_class: null,
            error_message: null,
            latency_ms: '321',
            input_tokens: 12,
            output_tokens: '8',
            cost_estimate: '0.0025',
            attempt: 1,
            created_at: '2026-05-21T10:00:00.000Z',
          },
        ],
        [{ total: '1' }],
      ];
      const queries: Query[] = [];
      const repo = new RunResultRepository({
        execute: async (sqlQuery: SQL) => {
          queries.push(toQuery(sqlQuery));
          return queue.shift() ?? [];
        },
      } as unknown as DbClient);

      const out = await repo.listByRelease('11111111-1111-4111-8111-111111111111', {
        ...defaultReleaseQuery,
        externalId: 'order',
        search: 'approve',
      });

      expect(out.total).toBe(1);
      expect(out.data[0]).toMatchObject({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        projectId: '11111111-1111-4111-8111-111111111111',
        source: 'release',
        sourceId: '55555555-5555-4555-8555-555555555555',
        lane: 'production',
        eventId: '55555555-5555-4555-8555-555555555555',
        canaryId: null,
        externalId: 'order-1',
        promptVersionNumber: 3,
        status: 'success',
        judgmentStatus: 'correct',
        latencyMs: 321,
        inputTokens: 12,
        outputTokens: 8,
        costEstimate: 0.0025,
      });
      expect(queries[0]!.sql).toContain('rr.project_id =');
      expect(queries[0]!.sql).toContain("rr.source = 'release'");
      expect(queries[0]!.sql).toContain('JOIN ph_releases.release_line_events release_event');
      expect(queries[0]!.sql).toContain('rr.source_id IN');
      expect(queries[0]!.sql).not.toContain('legacy_source_id');
      expect(queries[0]!.sql).toContain('rr.prompt_version_id IN');
      expect(queries[0]!.sql).toContain('rr.external_id ILIKE');
      expect(queries[0]!.sql).toContain('rr.raw_response ILIKE');
      expect(queries[0]!.sql).toContain('ORDER BY rr.created_at DESC');
    });

    it('uses release_line_events.lane_type to distinguish canary run results', async () => {
      const repo = new RunResultRepository(
        dbSequence(
          [
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              project_id: '11111111-1111-4111-8111-111111111111',
              source: 'release',
              source_id: '88888888-8888-4888-8888-888888888888',
              release_event_id: '88888888-8888-4888-8888-888888888888',
              lane_type: 'canary',
              external_id: 'order-2',
              prompt_version_id: '66666666-6666-4666-8666-666666666666',
              prompt_version_number: 4,
              model_id: '77777777-7777-4777-8777-777777777777',
              status: 'success',
              judgment_status: 'incorrect',
              is_correct: false,
              decision_output: 'reject',
              input_variables: { id: 'order-2' },
              raw_response: '{"decision":"reject"}',
              parsed_output: { decision: 'reject' },
              error_class: null,
              error_message: null,
              latency_ms: 456,
              input_tokens: 14,
              output_tokens: 9,
              cost_estimate: '0.0031',
              attempt: 1,
              created_at: '2026-05-21T10:01:00.000Z',
            },
          ],
          [{ total: 1 }],
        ),
      );

      const out = await repo.listByRelease('11111111-1111-4111-8111-111111111111', {
        ...defaultReleaseQuery,
        lane: ['canary'],
      });

      expect(out.data[0]).toMatchObject({
        source: 'release',
        sourceId: '88888888-8888-4888-8888-888888888888',
        lane: 'canary',
        eventId: '88888888-8888-4888-8888-888888888888',
        canaryId: '88888888-8888-4888-8888-888888888888',
      });
    });
  });

  describe('getDetailById', () => {
    it('returns null when no row is found', async () => {
      const repo = new RunResultRepository(fakeDb([]));
      const result = await repo.getDetailById(
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      );
      expect(result).toBeNull();
    });

    it('returns RunResultDetailDto with parsed_output / rendered_prompt fields', async () => {
      const repo = new RunResultRepository(
        fakeDb([
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            source_id: '11111111-1111-1111-1111-111111111111',
            sample_id: null,
            external_id: 'ext-1',
            status: 'error',
            judgment_status: null,
            is_correct: null,
            decision_output: null,
            expected_output: 'positive',
            sample_data: { name: 'Alice' },
            dataset_field_schema: [{ name: 'name', role: 'text', type: 'string' }],
            error_class: 'parse',
            error_message: 'invalid json',
            latency_ms: 999,
            input_tokens: 30,
            output_tokens: 0,
            cost_estimate: '0.001',
            attempt: 2,
            created_at: '2026-05-19T11:00:00.000Z',
            prompt_version_id: '33333333-3333-3333-3333-333333333333',
            model_id: '44444444-4444-4444-4444-444444444444',
            rendered_prompt: { messages: [{ role: 'user', content: 'hi' }] },
            input_variables: { name: 'Alice' },
            raw_response: 'oops',
            parsed_output: null,
            dbos_workflow_id: 'wf-1',
            bullmq_job_id: 'job-1',
          },
        ]),
      );

      const detail = await repo.getDetailById(
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      );
      expect(detail).toMatchObject({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        experimentId: '11111111-1111-1111-1111-111111111111',
        source: 'experiment',
        status: 'error',
        errorClass: 'parse',
        errorMessage: 'invalid json',
        rawResponse: 'oops',
        promptVersionId: '33333333-3333-3333-3333-333333333333',
        modelId: '44444444-4444-4444-4444-444444444444',
        datasetTextFields: [{ name: 'name', role: 'text', value: 'Alice' }],
        dbosWorkflowId: 'wf-1',
        bullmqJobId: 'job-1',
      });
    });
  });

  describe('findAccessibleExperiment', () => {
    it('returns null when no row matches', async () => {
      const repo = new RunResultRepository(fakeDb([]));
      const out = await repo.findAccessibleExperiment(
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
        false,
      );
      expect(out).toBeNull();
    });

    it('returns access row when found', async () => {
      const repo = new RunResultRepository(
        fakeDb([
          {
            experiment_id: '22222222-2222-2222-2222-222222222222',
            project_id: '11111111-1111-1111-1111-111111111111',
          },
        ]),
      );
      const out = await repo.findAccessibleExperiment(
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
        false,
      );
      expect(out).toEqual({
        experimentId: '22222222-2222-2222-2222-222222222222',
        projectId: '11111111-1111-1111-1111-111111111111',
      });
    });
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
