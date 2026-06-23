import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Optional } from '@nestjs/common';
import {
  llmJobPayloadSchema,
  probeJobPayloadSchema,
  type LlmJobPayload,
  type ProbeJobPayload,
} from '@proofhound/orchestration-shared';
import type { Queue } from 'bullmq';
import { LlmAdmissionStore } from '../../../shared/llm-admission/llm-admission.store';
import { LimiterKeyStrategy } from '../../../server/common/contracts/limiter-key.strategy';

@Injectable()
export class BullmqService {
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
        fairnessKey: this.limiterKeyStrategy!.buildModelKey(
          { projectId: parsed.projectId, orgId: parsed.orgId, source: 'local' },
          parsed.modelId,
        ),
        payload: parsed,
      });
      return finalJobId;
    }

    const job = await this.llmQueue.add('llm-invoke', parsed, jobId ? { jobId } : undefined);
    return String(job.id);
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
}
