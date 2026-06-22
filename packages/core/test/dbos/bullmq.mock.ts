// Test double for BullmqService: does not connect to Redis; on enqueue, writes the run_result directly into ph_runs.run_results
// to simulate worker completion, so ExperimentWorkflow's pollUntilBatchDone is satisfied immediately.

import type { DbClient } from '@proofhound/db';
import { createLogger } from '@proofhound/logger';
import type { LlmJobPayload } from '@proofhound/orchestration-shared';
import { sql } from 'drizzle-orm';

const logger = createLogger('bullmq.mock', { service: 'integration-test' });

export type MockBullmqBehavior =
  | 'all_success' // Write status='success', judgment='correct' for every sample
  | 'all_error' // Write status='failed', judgment=null for every sample
  | 'never_complete'; // Do not write run_result, letting the workflow keep polling (for timeout tests; use with caution)

export interface EnqueueCall {
  payload: LlmJobPayload;
  runResultId: string;
}

export interface RemoveQueuedLlmJobsResult {
  requested: number;
  removed: number;
  skipped: number;
  missing: number;
  failed: number;
  removedJobIds: string[];
  states: Record<string, number>;
}

export interface CleanupStoppedLlmJobsResult extends RemoveQueuedLlmJobsResult {
  missingJobIds: string[];
  terminalJobs: [];
  terminalRemoved: number;
  terminalRemoveFailed: number;
  invalidTerminalPayloads: number;
  invalidTerminalJobIds: string[];
}

export class MockBullmqService {
  private behavior: MockBullmqBehavior = 'all_success';
  private calls: EnqueueCall[] = [];

  constructor(private readonly db: DbClient) {}

  setBehavior(behavior: MockBullmqBehavior): void {
    this.behavior = behavior;
    logger.debug({ behavior }, 'mock_set_behavior');
  }

  getCalls(): EnqueueCall[] {
    return [...this.calls];
  }

  reset(): void {
    this.behavior = 'all_success';
    this.calls = [];
  }

  // Same signature as the real BullmqService.enqueueLlmJob
  async enqueueLlmJob(payload: LlmJobPayload, runResultId?: string): Promise<string> {
    const rrId = runResultId ?? payload.runResultId;
    if (!rrId) {
      throw new Error('mock_bullmq_missing_run_result_id');
    }
    this.calls.push({ payload, runResultId: rrId });
    logger.debug(
      {
        behavior: this.behavior,
        sourceId: payload.sourceId,
        sampleId: payload.sampleId,
        runResultId: rrId,
      },
      'mock_enqueue_llm_job',
    );

    if (this.behavior === 'never_complete') {
      return rrId;
    }

    const status: 'success' | 'failed' = this.behavior === 'all_error' ? 'failed' : 'success';
    const expectedOutputStr = String(payload.judgment?.expectedOutput ?? '');
    const decisionOutput = status === 'success' ? expectedOutputStr : null;
    const judgmentStatus = status === 'success' ? 'correct' : null;
    const isCorrect = status === 'success';

    const renderedPromptJson = JSON.stringify(payload.renderedPrompt);
    const inputVariablesJson = JSON.stringify(payload.inputVariables ?? {});
    await this.db.execute(sql`
      INSERT INTO ph_runs.run_results
        (id, project_id, source, source_id, prompt_version_id, model_id, sample_id,
         rendered_prompt, input_variables,
         status, is_correct, decision_output, expected_output, judgment_status,
         input_tokens, output_tokens, attempt)
      VALUES
        (${rrId}::uuid, ${payload.projectId}::uuid, ${payload.source}, ${payload.sourceId}::uuid,
         ${payload.promptVersionId}::uuid, ${payload.modelId}::uuid, ${payload.sampleId ?? null}::uuid,
         ${renderedPromptJson}::jsonb, ${inputVariablesJson}::jsonb,
         ${status}, ${isCorrect}, ${decisionOutput}, ${expectedOutputStr}, ${judgmentStatus},
         10, 5, 1)
    `);

    return rrId;
  }

  async removeQueuedLlmJobs(jobIds: readonly string[]): Promise<RemoveQueuedLlmJobsResult> {
    return {
      requested: new Set(jobIds).size,
      removed: 0,
      skipped: 0,
      missing: 0,
      failed: 0,
      removedJobIds: [],
      states: {},
    };
  }

  async cleanupStoppedLlmJobs(jobIds: readonly string[]): Promise<CleanupStoppedLlmJobsResult> {
    return {
      requested: new Set(jobIds).size,
      removed: 0,
      skipped: 0,
      missing: 0,
      failed: 0,
      removedJobIds: [],
      missingJobIds: [],
      terminalJobs: [],
      terminalRemoved: 0,
      terminalRemoveFailed: 0,
      invalidTerminalPayloads: 0,
      invalidTerminalJobIds: [],
      states: {},
    };
  }
}
