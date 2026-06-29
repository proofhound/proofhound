import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Optional } from '@nestjs/common';
import {
  llmJobPayloadSchema,
  probeJobPayloadSchema,
  type LlmJobPayload,
  type ProbeJobPayload,
} from '@proofhound/orchestration-shared';
import { createLogger } from '@proofhound/logger';
import type { Queue } from 'bullmq';
import { LlmAdmissionStore } from '../../../shared/llm-admission/llm-admission.store';
import { LimiterKeyStrategy } from '../../common/contracts/limiter-key.strategy';

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

export interface FindTerminalLlmJobsResult {
  requested: number;
  missing: number;
  skipped: number;
  terminalJobs: StoppedLlmTerminalJob[];
  invalidTerminalPayloads: number;
  invalidTerminalJobIds: string[];
  states: Record<string, number>;
}

// BullMQ producer: business Services dispatch tasks through this service
// See docs/specs/03-orchestration.md §2
@Injectable()
export class BullmqService {
  private readonly logger = createLogger('bullmq.service', { service: 'server' });

  constructor(
    @InjectQueue('llm') private readonly llmQueue: Queue<LlmJobPayload>,
    @InjectQueue('probe') private readonly probeQueue: Queue<ProbeJobPayload>,
    @Optional() private readonly admissionStore?: LlmAdmissionStore,
    @Optional() private readonly limiterKeyStrategy?: LimiterKeyStrategy,
  ) {}

  async enqueueLlmJob(payload: LlmJobPayload, jobId?: string): Promise<string> {
    const parsed = llmJobPayloadSchema.parse(payload);
    if (this.shouldUseLlmAdmission()) {
      const finalJobId = jobId ?? parsed.runResultId ?? randomUUID();
      await this.admissionStore!.enqueuePendingLlmJob({
        jobId: finalJobId,
        fairnessKey: this.buildLlmFairnessKey(parsed),
        payload: parsed,
      });
      return finalJobId;
    }

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
    const pendingRemoved = await this.removePendingLlmJobs(uniqueJobIds);
    if (pendingRemoved.size > 0) {
      result.removed += pendingRemoved.size;
      result.removedJobIds.push(...pendingRemoved);
      result.states['pending'] = (result.states['pending'] ?? 0) + pendingRemoved.size;
    }

    for (const jobId of uniqueJobIds) {
      if (pendingRemoved.has(jobId)) continue;
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
        await this.clearLlmAdmissionDedupe(jobId);
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
    const pendingRemoved = await this.removePendingLlmJobs(uniqueJobIds);
    if (pendingRemoved.size > 0) {
      result.removed += pendingRemoved.size;
      result.removedJobIds.push(...pendingRemoved);
      result.states['pending'] = (result.states['pending'] ?? 0) + pendingRemoved.size;
    }

    for (const jobId of uniqueJobIds) {
      if (pendingRemoved.has(jobId)) continue;
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
          await this.clearLlmAdmissionDedupe(jobId);
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
          await this.clearLlmAdmissionDedupe(jobId);
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

  async findTerminalLlmJobs(jobIds: readonly string[]): Promise<FindTerminalLlmJobsResult> {
    const uniqueJobIds = [...new Set(jobIds)];
    const result: FindTerminalLlmJobsResult = {
      requested: uniqueJobIds.length,
      missing: 0,
      skipped: 0,
      terminalJobs: [],
      invalidTerminalPayloads: 0,
      invalidTerminalJobIds: [],
      states: {},
    };
    const pendingIds = await this.findPendingLlmJobs(uniqueJobIds);
    if (pendingIds.size > 0) {
      result.skipped += pendingIds.size;
      result.states['pending'] = (result.states['pending'] ?? 0) + pendingIds.size;
    }

    for (const jobId of uniqueJobIds) {
      if (pendingIds.has(jobId)) continue;
      const job = await this.llmQueue.getJob(jobId);
      if (!job) {
        result.missing += 1;
        continue;
      }

      const state = await job.getState();
      result.states[state] = (result.states[state] ?? 0) + 1;
      if (!TERMINAL_LLM_JOB_STATES.has(state)) {
        result.skipped += 1;
        continue;
      }

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
        this.logger.warn({ jobId, state, error: parsed.error.message }, 'bullmq_terminal_llm_job_payload_invalid');
      }
    }

    return result;
  }

  async enqueueProbeJob(payload: ProbeJobPayload, jobId?: string): Promise<string> {
    const parsed = probeJobPayloadSchema.parse(payload);
    const job = await this.probeQueue.add('probe-model', parsed, jobId ? { jobId } : undefined);
    return String(job.id);
  }

  private shouldUseLlmAdmission(): boolean {
    return (
      process.env['PH_LLM_ADMISSION_ENABLED'] !== 'false' &&
      this.admissionStore !== undefined &&
      this.limiterKeyStrategy !== undefined
    );
  }

  private buildLlmFairnessKey(payload: LlmJobPayload): string {
    return this.limiterKeyStrategy!.buildModelKey(
      { projectId: payload.projectId, orgId: payload.orgId, source: 'local' },
      payload.modelId,
    );
  }

  private async removePendingLlmJobs(jobIds: readonly string[]): Promise<Set<string>> {
    if (!this.shouldUseLlmAdmission()) return new Set();
    return new Set(await this.admissionStore!.removePendingLlmJobs(jobIds));
  }

  private async findPendingLlmJobs(jobIds: readonly string[]): Promise<Set<string>> {
    if (!this.shouldUseLlmAdmission()) return new Set();
    return new Set(await this.admissionStore!.findPendingLlmJobIds(jobIds));
  }

  private async clearLlmAdmissionDedupe(jobId: string): Promise<void> {
    await this.admissionStore?.clearLlmJobDedupe?.([jobId]);
  }
}
