import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  llmJobPayloadSchema,
  probeJobPayloadSchema,
  type LlmJobPayload,
  type ProbeJobPayload,
} from '@proofhound/orchestration-shared';
import { createLogger } from '@proofhound/logger';
import type { Queue } from 'bullmq';

const REMOVABLE_LLM_JOB_STATES = new Set(['waiting', 'delayed', 'prioritized', 'waiting-children', 'paused']);
const TERMINAL_LLM_JOB_STATES = new Set(['completed', 'failed']);

export interface RemoveQueuedLlmJobsResult {
  requested: number;
  removed: number;
  skipped: number;
  missing: number;
  failed: number;
  removedJobIds: string[];
  states: Record<string, number>;
}

export interface StoppedLlmTerminalJob {
  jobId: string;
  state: 'completed' | 'failed';
  payload: LlmJobPayload;
  failedReason: string | null;
  attemptsMade: number | null;
}

export interface CleanupStoppedLlmJobsResult extends RemoveQueuedLlmJobsResult {
  missingJobIds: string[];
  terminalJobs: StoppedLlmTerminalJob[];
  terminalRemoved: number;
  terminalRemoveFailed: number;
  invalidTerminalPayloads: number;
  invalidTerminalJobIds: string[];
}

// BullMQ producer: business Services dispatch tasks through this service
// See docs/specs/03-orchestration.md §2
@Injectable()
export class BullmqService {
  private readonly logger = createLogger('bullmq.service', { service: 'server' });

  constructor(
    @InjectQueue('llm') private readonly llmQueue: Queue<LlmJobPayload>,
    @InjectQueue('probe') private readonly probeQueue: Queue<ProbeJobPayload>,
  ) {}

  async enqueueLlmJob(payload: LlmJobPayload, jobId?: string): Promise<string> {
    const parsed = llmJobPayloadSchema.parse(payload);
    const job = await this.llmQueue.add('llm-invoke', parsed, jobId ? { jobId } : undefined);
    return String(job.id);
  }

  async removeQueuedLlmJobs(jobIds: readonly string[]): Promise<RemoveQueuedLlmJobsResult> {
    const uniqueJobIds = [...new Set(jobIds)];
    const result: RemoveQueuedLlmJobsResult = {
      requested: uniqueJobIds.length,
      removed: 0,
      skipped: 0,
      missing: 0,
      failed: 0,
      removedJobIds: [],
      states: {},
    };

    for (const jobId of uniqueJobIds) {
      const job = await this.llmQueue.getJob(jobId);
      if (!job) {
        result.missing += 1;
        continue;
      }

      const state = await job.getState();
      result.states[state] = (result.states[state] ?? 0) + 1;
      if (!REMOVABLE_LLM_JOB_STATES.has(state)) {
        result.skipped += 1;
        continue;
      }

      try {
        await job.remove();
        result.removed += 1;
        result.removedJobIds.push(jobId);
      } catch (error) {
        result.failed += 1;
        this.logger.warn({ jobId, state, error: (error as Error).message }, 'bullmq_remove_queued_llm_job_failed');
      }
    }

    return result;
  }

  async cleanupStoppedLlmJobs(jobIds: readonly string[]): Promise<CleanupStoppedLlmJobsResult> {
    const uniqueJobIds = [...new Set(jobIds)];
    const result: CleanupStoppedLlmJobsResult = {
      requested: uniqueJobIds.length,
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

    for (const jobId of uniqueJobIds) {
      const job = await this.llmQueue.getJob(jobId);
      if (!job) {
        result.missing += 1;
        result.missingJobIds.push(jobId);
        continue;
      }

      const state = await job.getState();
      result.states[state] = (result.states[state] ?? 0) + 1;
      if (REMOVABLE_LLM_JOB_STATES.has(state)) {
        try {
          await job.remove();
          result.removed += 1;
          result.removedJobIds.push(jobId);
        } catch (error) {
          result.failed += 1;
          this.logger.warn({ jobId, state, error: (error as Error).message }, 'bullmq_remove_queued_llm_job_failed');
        }
        continue;
      }

      if (TERMINAL_LLM_JOB_STATES.has(state)) {
        const parsed = llmJobPayloadSchema.safeParse(job.data);
        if (parsed.success) {
          result.terminalJobs.push({
            jobId,
            state: state as 'completed' | 'failed',
            payload: parsed.data,
            failedReason: job.failedReason ?? null,
            attemptsMade: job.attemptsMade ?? null,
          });
        } else {
          result.invalidTerminalPayloads += 1;
          result.invalidTerminalJobIds.push(jobId);
          this.logger.warn(
            { jobId, state, error: parsed.error.message },
            'bullmq_stopped_terminal_llm_job_payload_invalid',
          );
        }

        try {
          await job.remove();
          result.terminalRemoved += 1;
        } catch (error) {
          result.terminalRemoveFailed += 1;
          this.logger.warn({ jobId, state, error: (error as Error).message }, 'bullmq_remove_terminal_llm_job_failed');
        }
        continue;
      }

      result.skipped += 1;
    }

    return result;
  }

  async enqueueProbeJob(payload: ProbeJobPayload, jobId?: string): Promise<string> {
    const parsed = probeJobPayloadSchema.parse(payload);
    const job = await this.probeQueue.add('probe-model', parsed, jobId ? { jobId } : undefined);
    return String(job.id);
  }
}
