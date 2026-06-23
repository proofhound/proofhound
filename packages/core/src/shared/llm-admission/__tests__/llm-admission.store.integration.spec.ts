import Redis from 'ioredis';
import { Queue } from 'bullmq';
import type { RuntimeLimits } from '@proofhound/orchestration-shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LlmAdmissionDispatcher } from '../../../worker/llm-admission-dispatcher';
import { LlmAdmissionStore } from '../llm-admission.store';

// Integration test: skipped by default; enabled when REDIS_TEST_URL is set.
// Locally: docker compose -f dev/docker-compose.yml up -d redis
//      REDIS_TEST_URL=redis://localhost:6379/14 pnpm --filter @proofhound/core exec vitest run --config ./vitest.integration.config.ts src/shared/llm-admission/__tests__/llm-admission.store.integration.spec.ts
const REDIS_URL = process.env['REDIS_TEST_URL'];
const describeIf = REDIS_URL ? describe : describe.skip;

const modelId = '00000000-0000-4000-8000-000000000004';
const basePayload = {
  projectId: '00000000-0000-4000-8000-000000000001',
  source: 'experiment' as const,
  sourceId: '00000000-0000-4000-8000-000000000002',
  promptVersionId: '00000000-0000-4000-8000-000000000003',
  modelId,
  renderedPrompt: { prompt: 'hello' },
};

describeIf('LlmAdmissionStore + dispatcher (integration, real Redis/BullMQ)', () => {
  let redis: Redis;
  let store: LlmAdmissionStore;
  let queue: Queue;
  const prefix = `ph:test:llm-admission:${Date.now()}`;
  const queueName = `llm-admission-test-${Date.now()}`;

  beforeAll(async () => {
    process.env['PH_LLM_ADMISSION_REDIS_PREFIX'] = prefix;
    redis = new Redis(REDIS_URL!, { maxRetriesPerRequest: null, lazyConnect: false });
    await redis.ping();
    queue = new Queue(queueName, { connection: { url: REDIS_URL! } });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
    delete process.env['PH_LLM_ADMISSION_REDIS_PREFIX'];
  });

  beforeEach(async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await queue.drain(true);
    store = new LlmAdmissionStore(redis);
  });

  it('dedupes pending jobs, preserves FIFO order, and clears dedupe on removal', async () => {
    await expect(store.enqueuePendingLlmJob(pending('job-1', 'key-a'))).resolves.toBe(true);
    await expect(store.enqueuePendingLlmJob(pending('job-1', 'key-a'))).resolves.toBe(false);
    await expect(store.enqueuePendingLlmJob(pending('job-2', 'key-a'))).resolves.toBe(true);

    await expect(store.peekNextPendingJob('key-a')).resolves.toMatchObject({ jobId: 'job-1' });
    await expect(store.removePendingLlmJobs(['job-1'])).resolves.toEqual(['job-1']);
    await expect(store.peekNextPendingJob('key-a')).resolves.toMatchObject({ jobId: 'job-2' });

    await expect(store.enqueuePendingLlmJob(pending('job-1', 'key-a'))).resolves.toBe(true);
  });

  it('enforces admission leases atomically, supports heartbeat extension, release, and TTL recovery', async () => {
    await expect(
      store.tryReserveConcurrency({ fairnessKey: 'key-a', reservationId: uuid('100') }, 1, 150),
    ).resolves.toBe(true);
    await expect(
      store.tryReserveConcurrency({ fairnessKey: 'key-a', reservationId: uuid('101') }, 1, 150),
    ).resolves.toBe(false);

    await sleep(80);
    await expect(
      store.extendConcurrencyReservation({ fairnessKey: 'key-a', reservationId: uuid('100') }, 250),
    ).resolves.toBe(true);
    await sleep(120);
    await expect(
      store.tryReserveConcurrency({ fairnessKey: 'key-a', reservationId: uuid('102') }, 1, 150),
    ).resolves.toBe(false);

    await store.releaseConcurrencyReservation({ fairnessKey: 'key-a', reservationId: uuid('100') });
    await expect(
      store.tryReserveConcurrency({ fairnessKey: 'key-a', reservationId: uuid('103') }, 1, 100),
    ).resolves.toBe(true);
    await sleep(130);
    await expect(
      store.tryReserveConcurrency({ fairnessKey: 'key-a', reservationId: uuid('104') }, 1, 100),
    ).resolves.toBe(true);
  }, 5_000);

  it('allows only one dispatcher leader until the leader lease expires', async () => {
    await expect(store.acquireDispatcherLeadership('dispatcher-a', 120)).resolves.toBe(true);
    await expect(store.acquireDispatcherLeadership('dispatcher-b', 120)).resolves.toBe(false);
    await expect(store.acquireDispatcherLeadership('dispatcher-a', 120)).resolves.toBe(true);
    await sleep(150);
    await expect(store.acquireDispatcherLeadership('dispatcher-b', 120)).resolves.toBe(true);
  }, 5_000);

  it('admits an available key while another key is out of slots', async () => {
    await store.enqueuePendingLlmJob(pending('job-a', 'key-a'));
    await store.enqueuePendingLlmJob(pending('job-b', 'key-b'));
    await store.tryReserveConcurrency({ fairnessKey: 'key-a', reservationId: uuid('200') }, 1, 5_000);

    const dispatcher = createDispatcher(store, queue);
    await expect(dispatcher.dispatchOnce()).resolves.toBe(1);

    const blockedJob = await queue.getJob('job-a');
    expect(blockedJob ?? null).toBeNull();
    const readyJob = await queue.getJob('job-b');
    expect(readyJob).toMatchObject({ id: 'job-b' });
    expect(readyJob?.data.admission).toMatchObject({ fairnessKey: 'key-b', concurrencyLimit: 1 });
    await expect(store.getPendingLlmJob('job-a')).resolves.toMatchObject({ jobId: 'job-a' });
    await expect(store.getPendingLlmJob('job-b')).resolves.toBeNull();
  });

  it('recovers when BullMQ ready add succeeded before pending mark-ready', async () => {
    await store.enqueuePendingLlmJob(pending('job-c', 'key-c'));
    await queue.add('llm-invoke', { ...basePayload, runResultId: uuid('300') }, { jobId: 'job-c' });

    const dispatcher = createDispatcher(store, queue);
    await expect(dispatcher.dispatchOnce()).resolves.toBe(0);

    await expect(queue.getJob('job-c')).resolves.toMatchObject({ id: 'job-c' });
    await expect(store.getPendingLlmJob('job-c')).resolves.toBeNull();
  });
});

function pending(jobId: string, fairnessKey: string) {
  return {
    jobId,
    fairnessKey,
    payload: basePayload,
  };
}

function createDispatcher(store: LlmAdmissionStore, queue: Queue) {
  return new LlmAdmissionDispatcher(
    fakeDb({ rpmLimit: 60, tpmLimit: 10_000, concurrencyLimit: 1, autoConcurrency: false, isActive: true }) as never,
    { getUsage: async () => undefined } as never,
    queue as never,
    store,
    { mergeLlmLimits: async ({ limits }: { limits?: RuntimeLimits }) => limits } as never,
  );
}

function fakeDb(model: unknown) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [model],
        }),
      }),
    }),
  };
}

function uuid(suffix: string): string {
  return `00000000-0000-4000-8000-000000000${suffix}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
