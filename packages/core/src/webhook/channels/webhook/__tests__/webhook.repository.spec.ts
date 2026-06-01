import type { Query, SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { WebhookRepository, type WebhookRunResultRow } from '../webhook.repository';

describe('WebhookRepository', () => {
  it('counts parse errors as release failures without Date SQL params', async () => {
    let query: Query | null = null;
    const db = {
      execute: vi.fn(async (sqlQuery: SQL) => {
        query = toQuery(sqlQuery);
        return { rows: [{ inserted_count: 1 }] };
      }),
    };
    const repo = new WebhookRepository(db as never);
    const createdAt = new Date('2026-05-21T09:17:25.158Z');

    const inserted = await repo.attachResultToRelease('9548f0f8-bd27-4177-a423-1717b5021292', {
      id: '0fadc0b1-3e29-5b41-9fce-626abe6279aa',
      createdAt,
      status: 'success',
      externalId: 'chnsenticorp_train_00114',
      renderedPrompt: { prompt: 'hello' },
      inputVariables: { text: 'hello' },
      rawResponse: '{"sentiment":"negative"}',
      parsedOutput: { sentiment: 'negative' },
      decisionOutput: 'negative',
      expectedOutput: null,
      isCorrect: null,
      judgmentStatus: 'parse_error',
      errorClass: null,
      errorMessage: null,
      latencyMs: 1689,
      inputTokens: 677,
      outputTokens: 11,
      costEstimate: '0.001029',
    } satisfies WebhookRunResultRow);

    expect(inserted).toBe(true);
    expect(query).not.toBeNull();
    expect(query!.sql).toContain('total_errors = total_errors + $1');
    expect(query!.params).toContain(1);
    expect(query!.params.some((param) => param instanceof Date)).toBe(false);
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
