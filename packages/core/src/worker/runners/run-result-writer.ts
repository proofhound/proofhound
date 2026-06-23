import { Buffer } from 'node:buffer';
import { sql } from 'drizzle-orm';
import { DbClient } from '@proofhound/db';
import type { LLMRunResultRecord, LLMRunResultWriter } from '@proofhound/llm-client';
import { createLogger } from '@proofhound/logger';
import { QuotaPolicyHook } from '../../server/common/contracts/quota-policy.hook';
import { safeRecordUsageEvent, type UsageMeteringHook } from '../../server/common/contracts/usage-metering.hook';

// ph_runs.run_results is monthly-partitioned by created_at, so UNIQUE(id) cannot live on that table.
// Reserve id in unpartitioned ph_runs.run_result_ids first, then insert into the partitioned fact table, ensuring:
//  1. worker stalled retries do not write duplicate rows
//  2. when the consumer writes the final error row in OnWorkerEvent('failed'), an already-landed success row is not overwritten
export class DrizzleRunResultWriter implements LLMRunResultWriter {
  private readonly logger = createLogger('worker.run-result-writer', { service: 'worker' });

  constructor(
    private readonly db: DbClient,
    private readonly quotaPolicy: QuotaPolicyHook,
    private readonly usageMetering?: UsageMeteringHook,
  ) {}

  async writeRunResult(record: LLMRunResultRecord): Promise<void> {
    const sampleId = record.sampleId ?? null;
    const externalId = record.externalId ?? null;
    const inputVariables = record.inputVariables ?? null;
    const rawResponse = record.rawResponse ?? null;
    const parsedOutput = record.parsedOutput ?? null;
    const decisionOutput = record.decisionOutput ?? null;
    const expectedOutput = record.expectedOutput ?? null;
    const isCorrect = record.isCorrect ?? null;
    const judgmentStatus = record.judgmentStatus ?? null;
    const errorClass = record.errorClass ?? null;
    const errorMessage = record.errorMessage ?? null;
    const latencyMs = record.latencyMs ?? null;
    const inputTokens = record.inputTokens ?? null;
    const outputTokens = record.outputTokens ?? null;
    const costEstimate = record.costEstimate ?? null;
    const attempt = record.attempt ?? 1;
    const dbosWorkflowId = record.dbosWorkflowId ?? null;
    const bullmqJobId = record.bullmqJobId ?? null;
    const roundIndex = record.roundIndex ?? null;
    const releaseVersionId = record.releaseVersionId ?? null;
    const webhookTokenId = record.webhookTokenId ?? null;
    const project = record.orgId
      ? { projectId: record.projectId, orgId: record.orgId, source: 'local' as const }
      : { projectId: record.projectId, source: 'local' as const };
    await this.quotaPolicy.assertCanStore({
      bytes: estimateRunResultBytes(record),
      project,
      source: 'run_result',
    });

    const insertResult = await this.db.execute<{ id: string; created_at?: Date | string }>(sql`
      WITH reserved_run_result AS (
        INSERT INTO ph_runs.run_result_ids (id)
        VALUES (${record.id}::uuid)
        ON CONFLICT (id) DO NOTHING
        RETURNING id, created_at
      )
      INSERT INTO ph_runs.run_results (
        id, project_id, source, source_id, release_version_id, prompt_version_id, model_id,
        sample_id, external_id, rendered_prompt, input_variables,
        raw_response, parsed_output, decision_output, expected_output, is_correct, judgment_status,
        status, error_class, error_message,
        latency_ms, input_tokens, output_tokens, cost_estimate, attempt,
        dbos_workflow_id, bullmq_job_id, round_index, webhook_token_id, created_at
      )
      SELECT
        reserved_run_result.id, ${record.projectId}::uuid, ${record.source},
        ${record.sourceId}::uuid, ${releaseVersionId}::uuid, ${record.promptVersionId}::uuid, ${record.modelId}::uuid,
        ${sampleId}::uuid, ${externalId},
        ${JSON.stringify(record.renderedPrompt)}::jsonb,
        ${JSON.stringify(inputVariables)}::jsonb,
        ${rawResponse}, ${JSON.stringify(parsedOutput)}::jsonb,
        ${decisionOutput}, ${expectedOutput},
        ${isCorrect}, ${judgmentStatus},
        ${record.status}, ${errorClass}, ${errorMessage},
        ${latencyMs}, ${inputTokens}, ${outputTokens},
        ${costEstimate}, ${attempt},
        ${dbosWorkflowId}, ${bullmqJobId}, ${roundIndex}, ${webhookTokenId}::uuid,
        reserved_run_result.created_at
      FROM reserved_run_result
      RETURNING id, created_at
    `);

    const insertedRows = unwrapRows<{ id: string; created_at?: Date | string }>(insertResult);
    if (insertedRows.length > 0 && this.usageMetering) {
      const occurredAt = coerceDate(insertedRows[0]?.created_at);
      await safeRecordUsageEvent(
        this.usageMetering,
        {
          idempotencyKey: `run_result:${record.id}:created`,
          dimension: 'run_result',
          eventType: 'run_result.created',
          projectId: record.projectId,
          occurredAt,
          source: 'worker',
          payload: {
            runResultId: record.id,
            source: record.source,
            sourceId: record.sourceId,
            promptVersionId: record.promptVersionId,
            modelId: record.modelId,
            status: record.status,
            inputTokens,
            outputTokens,
            costEstimate,
            latencyMs,
            createdAt: occurredAt.toISOString(),
          },
        },
        this.logger,
      );
    }
  }
}

function estimateRunResultBytes(record: LLMRunResultRecord): number {
  return (
    utf8Bytes(record.renderedPrompt) +
    utf8Bytes(record.inputVariables) +
    utf8Bytes(record.rawResponse) +
    utf8Bytes(record.parsedOutput) +
    utf8Bytes(record.decisionOutput) +
    utf8Bytes(record.expectedOutput) +
    utf8Bytes(record.errorClass) +
    utf8Bytes(record.errorMessage)
  );
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null), 'utf8');
}

function unwrapRows<T = unknown>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
    return ((result as { rows?: T[] }).rows ?? []) as T[];
  }
  return [];
}

function coerceDate(value: Date | string | undefined): Date {
  if (value instanceof Date) return value;
  if (value) return new Date(value);
  return new Date();
}
