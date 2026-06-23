import { describe, expect, it, vi } from 'vitest';
import { LlmAdmissionDispatcher } from '../llm-admission-dispatcher';

const basePayload = {
  projectId: '00000000-0000-4000-8000-000000000001',
  source: 'experiment' as const,
  sourceId: '00000000-0000-4000-8000-000000000002',
  promptVersionId: '00000000-0000-4000-8000-000000000003',
  modelId: '00000000-0000-4000-8000-000000000004',
  runResultId: '00000000-0000-4000-8000-000000000005',
  sampleId: '00000000-0000-4000-8000-000000000006',
  renderedPrompt: { prompt: 'hello' },
};

describe('LlmAdmissionDispatcher', () => {
  it('continues admitting another fairness key when the first key has no available slot', async () => {
    const store = createStore([
      pendingJob('job-a', 'key-a'),
      pendingJob('job-b', 'key-b'),
    ]);
    store.tryReserveConcurrency.mockImplementation(async (reservation) => reservation.fairnessKey === 'key-b');
    const queue = {
      getJob: vi.fn(async () => null),
      add: vi.fn(async () => ({ id: 'job-b' })),
    };
    const dispatcher = createDispatcher({ store, queue });

    const admitted = await dispatcher.dispatchOnce();

    expect(admitted).toBe(1);
    expect(store.scheduleFairnessKey).toHaveBeenCalledWith('key-a', expect.any(Number));
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'llm-invoke',
      expect.objectContaining({
        admission: expect.objectContaining({ fairnessKey: 'key-b', concurrencyLimit: 3 }),
      }),
      { jobId: 'job-b' },
    );
    expect(store.markLlmJobReady).toHaveBeenCalledWith('job-b', 'key-b');
  });

  it('marks pending as ready without reserving again when BullMQ already has the job', async () => {
    const store = createStore([pendingJob('job-a', 'key-a')]);
    const queue = {
      getJob: vi.fn(async () => ({ id: 'job-a' })),
      add: vi.fn(),
    };
    const dispatcher = createDispatcher({ store, queue });

    const admitted = await dispatcher.dispatchOnce();

    expect(admitted).toBe(0);
    expect(store.markLlmJobReady).toHaveBeenCalledWith('job-a', 'key-a');
    expect(store.tryReserveConcurrency).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('keeps the admission lease when BullMQ add succeeds but pending mark-ready fails', async () => {
    const store = createStore([pendingJob('job-a', 'key-a')]);
    store.markLlmJobReady.mockRejectedValueOnce(new Error('redis unavailable'));
    const queue = {
      getJob: vi.fn(async () => null),
      add: vi.fn(async () => ({ id: 'job-a' })),
    };
    const dispatcher = createDispatcher({ store, queue });

    const admitted = await dispatcher.dispatchOnce();

    expect(admitted).toBe(0);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(store.tryReserveConcurrency).toHaveBeenCalledTimes(1);
    expect(store.releaseConcurrencyReservation).not.toHaveBeenCalled();
    expect(store.scheduleFairnessKey).not.toHaveBeenCalled();
  });
});

function pendingJob(jobId: string, fairnessKey: string) {
  return {
    jobId,
    fairnessKey,
    payload: basePayload,
    enqueuedAtMs: Date.now(),
    notBeforeMs: Date.now(),
  };
}

function createStore(pending: Array<ReturnType<typeof pendingJob>>) {
  const byKey = new Map(pending.map((job) => [job.fairnessKey, job]));
  return {
    defaultLeaseTtlMs: 600_000,
    getDueFairnessKeys: vi.fn(async () => [...byKey.keys()]),
    peekNextPendingJob: vi.fn(async (fairnessKey: string) => byKey.get(fairnessKey) ?? null),
    tryReserveConcurrency: vi.fn(async (_reservation: { fairnessKey: string }, _concurrencyLimit: number) => true),
    scheduleFairnessKey: vi.fn(async () => undefined),
    releaseConcurrencyReservation: vi.fn(async () => undefined),
    markLlmJobReady: vi.fn(async () => undefined),
    acquireDispatcherLeadership: vi.fn(async () => true),
  };
}

function createDispatcher(input: { store: ReturnType<typeof createStore>; queue: unknown }) {
  return new LlmAdmissionDispatcher(
    fakeDb({ rpmLimit: 60, tpmLimit: 10_000, concurrencyLimit: 3, autoConcurrency: false, isActive: true }) as never,
    { getUsage: vi.fn() } as never,
    input.queue as never,
    input.store as never,
    { mergeLlmLimits: vi.fn(async ({ limits }) => limits) } as never,
  );
}

function fakeDb(model: unknown) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [model]),
        })),
      })),
    })),
  };
}
