import type { Query, SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { DrizzleRunResultWriter } from '../run-result-writer';

describe('DrizzleRunResultWriter', () => {
  it('renders nullable run_result fields as SQL null params instead of omitted chunks', async () => {
    let query: Query | null = null;
    const db = {
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return [];
      }),
    };
    const writer = new DrizzleRunResultWriter(db as never);

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
    const writer = new DrizzleRunResultWriter(db as never);

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
});

function toQuery(query: SQL): Query {
  return query.toQuery({
    casing: {} as never,
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value}'`,
  });
}
