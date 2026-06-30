import type { Query, SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { DrizzleRunResultWriter } from '../run-result-writer';
import { LocalQuotaPolicyHook, type QuotaPolicyHook } from '../../../common/contracts/quota-policy.hook';
import type { UsageMeteringHook } from '../../../common/contracts/usage-metering.hook';

describe('DrizzleRunResultWriter', () => {
  it('renders nullable run_result fields as SQL null params instead of omitted chunks', async () => {
    let query: Query | null = null;
    const db = {
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return [];
      }),
    };
    const writer = new DrizzleRunResultWriter(db as never, new LocalQuotaPolicyHook());

    await writer.writeRunResult({
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      source: 'release',
      sourceId: '33333333-3333-4333-8333-333333333333',
      promptVersionId: '44444444-4444-4444-8444-444444444444',
      modelId: '55555555-5555-4555-8555-555555555555',
      externalId: 'external-1',
      renderedPrompt: { prompt: 'hello' },
      status: 'success',
      attempt: 1,
    });

    expect(query).not.toBeNull();
    expect(query!.sql).toContain('WITH reserved_run_result AS');
    expect(query!.sql).toContain('INSERT INTO ph_runs.run_result_ids');
    expect(query!.sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(query!.sql).toContain('reserved_run_result.created_at');
    expect(query!.sql).not.toContain('WHERE NOT EXISTS');
    expect(query!.sql).toContain('id, project_id, source');
    expect(query!.params).toContain('22222222-2222-4222-8222-222222222222');
    expect(query!.sql).not.toMatch(/,\s*,/u);
    expect(query!.params).not.toContain(undefined);
    expect(query!.params).toContain(null);
  });

  it('defaults a missing runtime attempt to avoid malformed SQL', async () => {
    let query: Query | null = null;
    const db = {
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return [];
      }),
    };
    const writer = new DrizzleRunResultWriter(db as never, new LocalQuotaPolicyHook());

    await writer.writeRunResult({
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      source: 'release',
      sourceId: '33333333-3333-4333-8333-333333333333',
      promptVersionId: '44444444-4444-4444-8444-444444444444',
      modelId: '55555555-5555-4555-8555-555555555555',
      renderedPrompt: { prompt: 'hello' },
      status: 'success',
    } as never);

    expect(query).not.toBeNull();
    expect(query!.sql).not.toMatch(/,\s*,/u);
    expect(query!.params).not.toContain(undefined);
    expect(query!.params).toContain(1);
  });

  it('passes orgId into storage quota checks when the workflow run_result carries override project context', async () => {
    const db = {
      execute: vi.fn(async () => []),
    };
    const quotaPolicy = createSpyQuotaPolicy();
    const writer = new DrizzleRunResultWriter(db as never, quotaPolicy);

    await writer.writeRunResult({
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      orgId: '99999999-9999-4999-8999-999999999999',
      source: 'optimization_generate',
      sourceId: '33333333-3333-4333-8333-333333333333',
      promptVersionId: '44444444-4444-4444-8444-444444444444',
      modelId: '55555555-5555-4555-8555-555555555555',
      renderedPrompt: { prompt: 'hello' },
      status: 'success',
      attempt: 1,
    });

    expect(quotaPolicy.assertCanStore).toHaveBeenCalledWith({
      bytes: expect.any(Number),
      project: {
        projectId: '22222222-2222-4222-8222-222222222222',
        orgId: '99999999-9999-4999-8999-999999999999',
        source: 'local',
      },
      source: 'run_result',
    });
  });

  it('records a workflow-sourced run_result.created usage event after a successful insert attempt', async () => {
    const db = {
      execute: vi.fn(async () => [{ id: '11111111-1111-4111-8111-111111111111' }]),
    };
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const writer = new DrizzleRunResultWriter(db as never, new LocalQuotaPolicyHook(), usageMetering);

    await writer.writeRunResult({
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      source: 'optimization_generate',
      sourceId: '33333333-3333-4333-8333-333333333333',
      promptVersionId: '44444444-4444-4444-8444-444444444444',
      modelId: '55555555-5555-4555-8555-555555555555',
      renderedPrompt: { prompt: 'hello' },
      status: 'success',
      attempt: 1,
    });

    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'run_result:11111111-1111-4111-8111-111111111111:created',
        dimension: 'run_result',
        eventType: 'run_result.created',
        projectId: '22222222-2222-4222-8222-222222222222',
        source: 'workflow',
        payload: expect.objectContaining({
          runResultId: '11111111-1111-4111-8111-111111111111',
          source: 'optimization_generate',
          modelId: '55555555-5555-4555-8555-555555555555',
        }),
      }),
    );
  });

  it('records run_result.created when drizzle returns rows on the result object', async () => {
    const db = {
      execute: vi.fn(async () => ({ rows: [{ id: '11111111-1111-4111-8111-111111111111' }] })),
    };
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const writer = new DrizzleRunResultWriter(db as never, new LocalQuotaPolicyHook(), usageMetering);

    await writer.writeRunResult({
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      source: 'optimization_generate',
      sourceId: '33333333-3333-4333-8333-333333333333',
      promptVersionId: '44444444-4444-4444-8444-444444444444',
      modelId: '55555555-5555-4555-8555-555555555555',
      renderedPrompt: { prompt: 'hello' },
      status: 'success',
      attempt: 1,
    });

    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'run_result.created',
        idempotencyKey: 'run_result:11111111-1111-4111-8111-111111111111:created',
      }),
    );
  });

  it('does not record run_result.created when the idempotent insert is skipped', async () => {
    const db = {
      execute: vi.fn(async () => []),
    };
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const writer = new DrizzleRunResultWriter(db as never, new LocalQuotaPolicyHook(), usageMetering);

    await writer.writeRunResult({
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      source: 'optimization_generate',
      sourceId: '33333333-3333-4333-8333-333333333333',
      promptVersionId: '44444444-4444-4444-8444-444444444444',
      modelId: '55555555-5555-4555-8555-555555555555',
      renderedPrompt: { prompt: 'hello' },
      status: 'success',
      attempt: 1,
    });

    expect(usageMetering.record).not.toHaveBeenCalled();
  });

  it('persists webhook_token_id when the record carries webhook-entry attribution', async () => {
    let query: Query | null = null;
    const db = {
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return [];
      }),
    };
    const writer = new DrizzleRunResultWriter(db as never, new LocalQuotaPolicyHook());

    await writer.writeRunResult({
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      source: 'release',
      sourceId: '33333333-3333-4333-8333-333333333333',
      promptVersionId: '44444444-4444-4444-8444-444444444444',
      modelId: '55555555-5555-4555-8555-555555555555',
      renderedPrompt: { prompt: 'hello' },
      status: 'success',
      attempt: 1,
      webhookTokenId: '99999999-9999-4999-8999-999999999999',
    });

    expect(query!.sql).toContain('webhook_token_id');
    expect(query!.params).toContain('99999999-9999-4999-8999-999999999999');
    expect(query!.params).not.toContain(undefined);
  });

  it('tags run_result.created with the worker event source when constructed for the worker', async () => {
    const db = {
      execute: vi.fn(async () => [{ id: '11111111-1111-4111-8111-111111111111' }]),
    };
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const writer = new DrizzleRunResultWriter(db as never, new LocalQuotaPolicyHook(), usageMetering, 'worker');

    await writer.writeRunResult({
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      source: 'experiment',
      sourceId: '33333333-3333-4333-8333-333333333333',
      promptVersionId: '44444444-4444-4444-8444-444444444444',
      modelId: '55555555-5555-4555-8555-555555555555',
      renderedPrompt: { prompt: 'hello' },
      status: 'success',
      attempt: 1,
    });

    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'run_result.created', source: 'worker' }),
    );
  });
});

function toQuery(query: SQL): Query {
  return query.toQuery({
    casing: {} as never,
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value}'`,
  });
}

function createSpyQuotaPolicy(): QuotaPolicyHook {
  return {
    assertCanStore: vi.fn(async () => undefined),
    withExecutionSlot: vi.fn(async (_input, run) => run()),
  };
}
