import { describe, expect, it, vi } from 'vitest';
import { BullmqService } from './bullmq.service';

function buildService(llmQueue: unknown, admissionStore?: unknown) {
  return new BullmqService(
    llmQueue as never,
    {} as never,
    admissionStore as never,
    { buildModelKey: vi.fn((_project, modelId: string) => `model:${modelId}`) } as never,
  );
}

const payload = {
  projectId: '00000000-0000-4000-8000-000000000001',
  source: 'experiment' as const,
  sourceId: '00000000-0000-4000-8000-000000000002',
  promptVersionId: '00000000-0000-4000-8000-000000000003',
  modelId: '00000000-0000-4000-8000-000000000004',
  runResultId: '00000000-0000-4000-8000-000000000005',
  sampleId: '00000000-0000-4000-8000-000000000006',
  renderedPrompt: { prompt: 'hello' },
};

describe('BullmqService.enqueueLlmJob admission path', () => {
  it('writes LLM jobs to pending admission instead of the ready queue', async () => {
    const llmQueue = { add: vi.fn() };
    const admissionStore = {
      enqueuePendingLlmJob: vi.fn(async () => true),
      removePendingLlmJobs: vi.fn(async () => []),
      findPendingLlmJobIds: vi.fn(async () => []),
    };

    const jobId = await buildService(llmQueue, admissionStore).enqueueLlmJob(payload, payload.runResultId);

    expect(jobId).toBe(payload.runResultId);
    expect(llmQueue.add).not.toHaveBeenCalled();
    expect(admissionStore.enqueuePendingLlmJob).toHaveBeenCalledWith({
      jobId: payload.runResultId,
      fairnessKey: `model:${payload.modelId}`,
      payload,
    });
  });
});

describe('BullmqService.removeQueuedLlmJobs', () => {
  it('removes only not-yet-started llm jobs', async () => {
    const waitingJob = {
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const delayedJob = {
      getState: vi.fn().mockResolvedValue('delayed'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const activeJob = {
      getState: vi.fn().mockResolvedValue('active'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const jobs = new Map<string, unknown>([
      ['waiting-id', waitingJob],
      ['delayed-id', delayedJob],
      ['active-id', activeJob],
    ]);
    const llmQueue = {
      getJob: vi.fn(async (jobId: string) => jobs.get(jobId) ?? null),
    };

    const result = await buildService(llmQueue).removeQueuedLlmJobs([
      'waiting-id',
      'delayed-id',
      'active-id',
      'missing-id',
      'waiting-id',
    ]);

    expect(result).toEqual({
      requested: 4,
      removed: 2,
      skipped: 1,
      missing: 1,
      failed: 0,
      removedJobIds: ['waiting-id', 'delayed-id'],
      states: { waiting: 1, delayed: 1, active: 1 },
    });
    expect(waitingJob.remove).toHaveBeenCalledTimes(1);
    expect(delayedJob.remove).toHaveBeenCalledTimes(1);
    expect(activeJob.remove).not.toHaveBeenCalled();
  });

  it('records remove failures without throwing', async () => {
    const waitingJob = {
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: vi.fn().mockRejectedValue(new Error('locked')),
    };
    const llmQueue = {
      getJob: vi.fn().mockResolvedValue(waitingJob),
    };

    const result = await buildService(llmQueue).removeQueuedLlmJobs(['waiting-id']);

    expect(result).toMatchObject({
      requested: 1,
      removed: 0,
      skipped: 0,
      missing: 0,
      failed: 1,
      removedJobIds: [],
      states: { waiting: 1 },
    });
  });

  it('removes pending admission jobs without counting them as BullMQ misses', async () => {
    const llmQueue = {
      getJob: vi.fn().mockResolvedValue(null),
    };
    const admissionStore = {
      enqueuePendingLlmJob: vi.fn(async () => true),
      removePendingLlmJobs: vi.fn(async () => ['pending-id']),
      findPendingLlmJobIds: vi.fn(async () => []),
    };

    const result = await buildService(llmQueue, admissionStore).removeQueuedLlmJobs(['pending-id', 'missing-id']);

    expect(result).toMatchObject({
      requested: 2,
      removed: 1,
      missing: 1,
      removedJobIds: ['pending-id'],
      states: { pending: 1 },
    });
    expect(llmQueue.getJob).toHaveBeenCalledTimes(1);
    expect(llmQueue.getJob).toHaveBeenCalledWith('missing-id');
  });
});

describe('BullmqService.cleanupStoppedLlmJobs', () => {
  it('removes queued jobs, returns terminal jobs for reconciliation, and keeps active jobs running', async () => {
    const waitingJob = {
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const failedJob = {
      data: payload,
      failedReason: 'provider down',
      attemptsMade: 3,
      getState: vi.fn().mockResolvedValue('failed'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const activeJob = {
      getState: vi.fn().mockResolvedValue('active'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const jobs = new Map<string, unknown>([
      ['waiting-id', waitingJob],
      ['failed-id', failedJob],
      ['active-id', activeJob],
    ]);
    const llmQueue = {
      getJob: vi.fn(async (jobId: string) => jobs.get(jobId) ?? null),
    };

    const result = await buildService(llmQueue).cleanupStoppedLlmJobs([
      'waiting-id',
      'failed-id',
      'active-id',
      'missing-id',
      'waiting-id',
    ]);

    expect(result).toMatchObject({
      requested: 4,
      removed: 1,
      skipped: 1,
      missing: 1,
      failed: 0,
      removedJobIds: ['waiting-id'],
      missingJobIds: ['missing-id'],
      terminalRemoved: 1,
      terminalRemoveFailed: 0,
      invalidTerminalPayloads: 0,
      invalidTerminalJobIds: [],
      states: { waiting: 1, failed: 1, active: 1 },
    });
    expect(result.terminalJobs).toEqual([
      {
        jobId: 'failed-id',
        state: 'failed',
        payload,
        failedReason: 'provider down',
        attemptsMade: 3,
      },
    ]);
    expect(waitingJob.remove).toHaveBeenCalledTimes(1);
    expect(failedJob.remove).toHaveBeenCalledTimes(1);
    expect(activeJob.remove).not.toHaveBeenCalled();
  });

  it('records invalid terminal payloads and removes the stale terminal job', async () => {
    const failedJob = {
      data: { source: 'experiment' },
      failedReason: 'bad payload',
      attemptsMade: 1,
      getState: vi.fn().mockResolvedValue('failed'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const llmQueue = {
      getJob: vi.fn().mockResolvedValue(failedJob),
    };

    const result = await buildService(llmQueue).cleanupStoppedLlmJobs(['failed-id']);

    expect(result).toMatchObject({
      requested: 1,
      removed: 0,
      skipped: 0,
      missing: 0,
      terminalRemoved: 1,
      invalidTerminalPayloads: 1,
      invalidTerminalJobIds: ['failed-id'],
      terminalJobs: [],
      states: { failed: 1 },
    });
    expect(failedJob.remove).toHaveBeenCalledTimes(1);
  });

  it('drops pending admission jobs during stop cleanup', async () => {
    const llmQueue = {
      getJob: vi.fn().mockResolvedValue(null),
    };
    const admissionStore = {
      enqueuePendingLlmJob: vi.fn(async () => true),
      removePendingLlmJobs: vi.fn(async () => ['pending-id']),
      findPendingLlmJobIds: vi.fn(async () => []),
    };

    const result = await buildService(llmQueue, admissionStore).cleanupStoppedLlmJobs(['pending-id', 'missing-id']);

    expect(result).toMatchObject({
      requested: 2,
      removed: 1,
      missing: 1,
      missingJobIds: ['missing-id'],
      removedJobIds: ['pending-id'],
      states: { pending: 1 },
    });
  });

  it('clears admission dedupe when a ready BullMQ job is removed', async () => {
    const waitingJob = {
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const llmQueue = {
      getJob: vi.fn().mockResolvedValue(waitingJob),
    };
    const admissionStore = {
      enqueuePendingLlmJob: vi.fn(async () => true),
      removePendingLlmJobs: vi.fn(async () => []),
      findPendingLlmJobIds: vi.fn(async () => []),
      clearLlmJobDedupe: vi.fn(async () => undefined),
    };

    const result = await buildService(llmQueue, admissionStore).cleanupStoppedLlmJobs(['ready-id']);

    expect(result.removedJobIds).toEqual(['ready-id']);
    expect(admissionStore.clearLlmJobDedupe).toHaveBeenCalledWith(['ready-id']);
  });
});

describe('BullmqService.findTerminalLlmJobs', () => {
  const payload = {
    projectId: '00000000-0000-4000-8000-000000000001',
    orgId: '00000000-0000-4000-8000-000000000099',
    source: 'experiment',
    sourceId: '00000000-0000-4000-8000-000000000002',
    promptVersionId: '00000000-0000-4000-8000-000000000003',
    modelId: '00000000-0000-4000-8000-000000000004',
    runResultId: '00000000-0000-4000-8000-000000000005',
    sampleId: '00000000-0000-4000-8000-000000000006',
    renderedPrompt: { prompt: 'hello' },
  };

  it('returns terminal jobs without removing queued or terminal jobs', async () => {
    const waitingJob = {
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const failedJob = {
      data: payload,
      failedReason: 'model is not available',
      attemptsMade: 5,
      getState: vi.fn().mockResolvedValue('failed'),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const jobs = new Map<string, unknown>([
      ['waiting-id', waitingJob],
      ['failed-id', failedJob],
    ]);
    const llmQueue = {
      getJob: vi.fn(async (jobId: string) => jobs.get(jobId) ?? null),
    };

    const result = await buildService(llmQueue).findTerminalLlmJobs(['waiting-id', 'failed-id', 'missing-id']);

    expect(result).toMatchObject({
      requested: 3,
      missing: 1,
      skipped: 1,
      invalidTerminalPayloads: 0,
      invalidTerminalJobIds: [],
      states: { waiting: 1, failed: 1 },
    });
    expect(result.terminalJobs).toEqual([
      {
        jobId: 'failed-id',
        state: 'failed',
        payload,
        failedReason: 'model is not available',
        attemptsMade: 5,
      },
    ]);
    expect(waitingJob.remove).not.toHaveBeenCalled();
    expect(failedJob.remove).not.toHaveBeenCalled();
  });

  it('treats pending admission jobs as non-terminal instead of missing', async () => {
    const llmQueue = {
      getJob: vi.fn().mockResolvedValue(null),
    };
    const admissionStore = {
      enqueuePendingLlmJob: vi.fn(async () => true),
      removePendingLlmJobs: vi.fn(async () => []),
      findPendingLlmJobIds: vi.fn(async () => ['pending-id']),
    };

    const result = await buildService(llmQueue, admissionStore).findTerminalLlmJobs(['pending-id', 'missing-id']);

    expect(result).toMatchObject({
      requested: 2,
      missing: 1,
      skipped: 1,
      states: { pending: 1 },
      terminalJobs: [],
    });
    expect(llmQueue.getJob).toHaveBeenCalledTimes(1);
    expect(llmQueue.getJob).toHaveBeenCalledWith('missing-id');
  });
});
