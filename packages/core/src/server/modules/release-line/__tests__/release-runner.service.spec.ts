import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BullmqService } from '../../../infrastructure/orchestration/bullmq.service';
import type { RedisMutexService } from '../../../../shared/redis/redis-mutex.service';
import type { ConnectorDriverFactory } from '../../connector/connector.driver-factory';
import type { ProjectContextResolver } from '../../../common/contracts/project-context.resolver';
import type { UsageMeteringHook } from '../../../common/contracts/usage-metering.hook';
import { computeReleaseRunResultId, passesTrafficRatio } from '../../canary-release/canary-runtime';
import {
  type ReleaseRunnerLaneRow,
  type ReleaseRunnerLineRow,
  type ReleaseRunnerRepository,
} from '../release-runner.repository';
import { buildReleaseLineLockKey, ReleaseRunnerService } from '../release-runner.service';

const releaseLineId = '11111111-1111-4111-8111-111111111111';
const productionEventId = '22222222-2222-4222-8222-222222222222';
const canaryEventId = '33333333-3333-4333-8333-333333333333';
const orgId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function lane(overrides: Partial<ReleaseRunnerLaneRow> = {}): ReleaseRunnerLaneRow {
  const laneType = overrides.laneType ?? 'production';
  return {
    id: laneType === 'production' ? productionEventId : canaryEventId,
    releaseLineId,
    projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    releaseVersionId: null,
    laneType,
    promptName: laneType === 'production' ? 'production prompt' : 'canary prompt',
    promptVersionId:
      laneType === 'production' ? '44444444-4444-4444-8444-444444444444' : '55555555-5555-4555-8555-555555555555',
    promptId: '66666666-6666-4666-8666-666666666666',
    modelId: '77777777-7777-4777-8777-777777777777',
    outputConnectorIds: [],
    status: 'running',
    controlState: null,
    controlStatePayload: null,
    trafficRatio: laneType === 'canary' ? 1 : null,
    trafficMode: laneType === 'canary' ? 'split' : null,
    recordMode: 'all',
    recordCategories: [],
    filterRules: null,
    variableMapping: [
      { source: 'sample_id', target: 'id', required: true },
      { source: 'text', target: 'text', required: true },
    ],
    outputMapping: [],
    externalIdField: 'sample_id',
    runConfig: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 1 },
    totalProcessed: 0,
    totalErrors: 0,
    startedAt: new Date('2026-05-21T10:00:00.000Z'),
    promptBody: 'Text: {{text}}',
    promptVariables: [{ name: 'text', type: 'text', required: true, datasetField: 'text' }],
    promptOutputSchema: { fields: [] },
    promptJudgmentRules: null,
    promptLanguage: 'zh-CN',
    createdBy: '88888888-8888-4888-8888-888888888888',
    ...overrides,
  };
}

function line(overrides: Partial<ReleaseRunnerLineRow> = {}): ReleaseRunnerLineRow {
  return {
    id: releaseLineId,
    projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    inputConnectorId: '99999999-9999-4999-8999-999999999999',
    inputConnectorType: 'kafka',
    inputConnectorDirection: 'input',
    inputConnectorConfig: { topic: 'orders', consumerGroup: 'orders-g1', batchSize: 1 },
    inputConnectorConfigEncrypted: null,
    production: lane(),
    canary: null,
    ...overrides,
  };
}

function repoMock(row: ReleaseRunnerLineRow) {
  return {
    listRunnableLines: vi.fn().mockResolvedValue([row]),
    findRunnableLine: vi.fn().mockResolvedValue(row),
    attachCompletedRunResults: vi.fn().mockResolvedValue([]),
    listOutputConnectorsByIds: vi.fn().mockResolvedValue([]),
    incrementReceived: vi.fn().mockResolvedValue(undefined),
    incrementFiltered: vi.fn().mockResolvedValue(undefined),
    recordOutputDelivery: vi.fn().mockResolvedValue(undefined),
    transitionLaneStatus: vi.fn().mockResolvedValue(undefined),
    clearControlState: vi.fn().mockResolvedValue(undefined),
  };
}

function mutexMock() {
  const lease = {
    key: buildReleaseLineLockKey(releaseLineId),
    token: 'lease-token',
    ttlMs: 60_000,
    renew: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(true),
  };
  return {
    lease,
    mutex: {
      acquire: vi.fn().mockResolvedValue(lease),
    },
  };
}

function driverFactoryMock() {
  return {
    consume: vi.fn().mockImplementation(async (args) => {
      await args.onMessage({
        id: 'orders:0:42',
        receivedAt: '2026-05-21T10:00:01.000Z',
        payload: { sample_id: 'sample-1', text: 'hello' },
        metadata: { topic: 'orders', partition: 0, offset: '42' },
      });
      return { source: 'driver', error: null };
    }),
    push: vi.fn(),
  };
}

function projectResolverMock() {
  return {
    resolve: vi.fn().mockResolvedValue({
      projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      orgId,
      source: 'local',
    }),
  };
}

function completedRunResult(
  overrides: Partial<ReturnType<typeof completedRunResultBase>> = {},
): ReturnType<typeof completedRunResultBase> {
  return { ...completedRunResultBase(), ...overrides };
}

function completedRunResultBase() {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099',
    projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    createdAt: new Date('2026-05-21T10:00:03.000Z'),
    externalId: 'sample-1',
    status: 'success',
    rawResponse: '{"ok":true}',
    parsedOutput: { ok: true },
    decisionOutput: 'allow',
    errorClass: null,
    errorMessage: null,
    latencyMs: 120,
    inputTokens: 10,
    outputTokens: 5,
    costEstimate: 0.001,
  };
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ReleaseRunnerService', () => {
  const originalLockTtl = process.env['RELEASE_RUNNER_LOCK_TTL_MS'];

  beforeEach(() => {
    delete process.env['RELEASE_RUNNER_LOCK_TTL_MS'];
  });

  afterEach(() => {
    if (originalLockTtl === undefined) {
      delete process.env['RELEASE_RUNNER_LOCK_TTL_MS'];
    } else {
      process.env['RELEASE_RUNNER_LOCK_TTL_MS'] = originalLockTtl;
    }
    vi.useRealTimers();
  });

  it('enqueues production traffic as release run results', async () => {
    const row = line();
    const repo = repoMock(row);
    const driverFactory = driverFactoryMock();
    const bullmq = { enqueueLlmJob: vi.fn().mockResolvedValue('job-1') };
    const { mutex, lease } = mutexMock();
    const projectResolver = projectResolverMock();
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactory as unknown as ConnectorDriverFactory,
      bullmq as unknown as BullmqService,
      mutex as unknown as RedisMutexService,
      projectResolver as unknown as ProjectContextResolver,
    );

    await service.scanOnce();
    await flushPromises();
    await service.onModuleDestroy();

    const runResultId = computeReleaseRunResultId(productionEventId, 'orders:0:42');
    expect(mutex.acquire).toHaveBeenCalledWith({ key: buildReleaseLineLockKey(row.id), ttlMs: 60_000 });
    expect(driverFactory.consume).toHaveBeenCalledWith(
      expect.objectContaining({ consumerName: `release-line-${row.id}` }),
    );
    expect(repo.incrementReceived).toHaveBeenCalledWith(productionEventId);
    expect(projectResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: releaseLineId,
        actorKind: 'system_release_runner',
        projectId: row.production?.projectId,
      }),
      { projectId: row.production?.projectId, projectIdHeader: row.production?.projectId },
    );
    expect(bullmq.enqueueLlmJob).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId,
        source: 'release',
        sourceId: productionEventId,
        runResultId,
        externalId: 'sample-1',
        inputVariables: { text: 'hello' },
      }),
      runResultId,
    );
    expect(lease.release).toHaveBeenCalled();
  });

  it('routes split hits to the active canary event', async () => {
    const canary = lane({ laneType: 'canary', trafficRatio: 1, trafficMode: 'split' });
    const row = line({ canary });
    const repo = repoMock(row);
    const driverFactory = driverFactoryMock();
    const bullmq = { enqueueLlmJob: vi.fn().mockResolvedValue('job-1') };
    const { mutex } = mutexMock();
    const projectResolver = projectResolverMock();
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactory as unknown as ConnectorDriverFactory,
      bullmq as unknown as BullmqService,
      mutex as unknown as RedisMutexService,
      projectResolver as unknown as ProjectContextResolver,
    );

    await service.scanOnce();
    await flushPromises();
    await service.onModuleDestroy();

    const runResultId = computeReleaseRunResultId(canaryEventId, 'orders:0:42');
    expect(repo.incrementReceived).toHaveBeenCalledWith(canaryEventId);
    expect(bullmq.enqueueLlmJob).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'release',
        sourceId: canaryEventId,
        runResultId,
        promptVersionId: canary.promptVersionId,
      }),
      runResultId,
    );
  });

  it('dual-runs production and canary through the same release source', async () => {
    const canary = lane({ laneType: 'canary', trafficRatio: 1, trafficMode: 'dual_run' });
    const row = line({ canary });
    const repo = repoMock(row);
    const driverFactory = driverFactoryMock();
    const bullmq = { enqueueLlmJob: vi.fn().mockResolvedValue('job-1') };
    const { mutex } = mutexMock();
    const projectResolver = projectResolverMock();
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactory as unknown as ConnectorDriverFactory,
      bullmq as unknown as BullmqService,
      mutex as unknown as RedisMutexService,
      projectResolver as unknown as ProjectContextResolver,
    );

    await service.scanOnce();
    await flushPromises();
    await service.onModuleDestroy();

    expect(bullmq.enqueueLlmJob).toHaveBeenCalledTimes(2);
    expect(bullmq.enqueueLlmJob).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'release', sourceId: productionEventId }),
      computeReleaseRunResultId(productionEventId, 'orders:0:42'),
    );
    expect(bullmq.enqueueLlmJob).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'release', sourceId: canaryEventId }),
      computeReleaseRunResultId(canaryEventId, 'orders:0:42'),
    );
  });

  it('uses external_id instead of queue message id for stable split assignment', async () => {
    const trafficRatio = 0.5;
    const canary = lane({ laneType: 'canary', trafficRatio, trafficMode: 'split' });
    const row = line({ canary });
    const repo = repoMock(row);
    const driverFactory = {
      consume: vi.fn().mockImplementation(async (args) => {
        await args.onMessage({
          id: 'orders:0:42',
          receivedAt: '2026-05-21T10:00:01.000Z',
          payload: { sample_id: 'same-business-id', text: 'first' },
          metadata: { topic: 'orders', partition: 0, offset: '42' },
        });
        await args.onMessage({
          id: 'orders:0:43',
          receivedAt: '2026-05-21T10:00:02.000Z',
          payload: { sample_id: 'same-business-id', text: 'second' },
          metadata: { topic: 'orders', partition: 0, offset: '43' },
        });
        return { source: 'driver', error: null };
      }),
      push: vi.fn(),
    };
    const bullmq = { enqueueLlmJob: vi.fn().mockResolvedValue('job-1') };
    const { mutex } = mutexMock();
    const projectResolver = projectResolverMock();
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactory as unknown as ConnectorDriverFactory,
      bullmq as unknown as BullmqService,
      mutex as unknown as RedisMutexService,
      projectResolver as unknown as ProjectContextResolver,
    );

    await service.scanOnce();
    await flushPromises();
    await service.onModuleDestroy();

    const expectedEventId = passesTrafficRatio(canaryEventId, 'same-business-id', trafficRatio)
      ? canaryEventId
      : productionEventId;
    expect(bullmq.enqueueLlmJob).toHaveBeenCalledTimes(2);
    expect(bullmq.enqueueLlmJob).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sourceId: expectedEventId, externalId: 'same-business-id' }),
      computeReleaseRunResultId(expectedEventId, 'orders:0:42'),
    );
    expect(bullmq.enqueueLlmJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sourceId: expectedEventId, externalId: 'same-business-id' }),
      computeReleaseRunResultId(expectedEventId, 'orders:0:43'),
    );
  });

  it('records release_run.attached when completed run results are collected', async () => {
    const row = line({ inputConnectorType: 'webhook' });
    const repo = repoMock(row);
    repo.attachCompletedRunResults.mockResolvedValue([completedRunResult()]);
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactoryMock() as unknown as ConnectorDriverFactory,
      { enqueueLlmJob: vi.fn() } as unknown as BullmqService,
      mutexMock().mutex as unknown as RedisMutexService,
      projectResolverMock() as unknown as ProjectContextResolver,
      usageMetering,
    );

    await service.scanOnce();

    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'release',
        eventType: 'release_run.attached',
        idempotencyKey: `release_run:${productionEventId}:aaaaaaaa-aaaa-4aaa-8aaa-000000000099:attached`,
        projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        source: 'release-runner',
      }),
    );
  });

  it('records and pushes only selected decision output categories', async () => {
    const outputConnectorId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010';
    const production = lane({
      outputConnectorIds: [outputConnectorId],
      recordMode: 'selected_categories',
      recordCategories: ['allow'],
    });
    const row = line({ inputConnectorType: 'webhook', production });
    const repo = repoMock(row);
    repo.attachCompletedRunResults.mockResolvedValue([
      completedRunResult({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099', decisionOutput: 'allow' }),
      completedRunResult({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000100', decisionOutput: 'deny' }),
    ]);
    repo.listOutputConnectorsByIds.mockResolvedValue([
      {
        id: outputConnectorId,
        type: 'webhook',
        direction: 'output',
        config: {},
        configEncrypted: null,
      },
    ]);
    const driverFactory = {
      consume: vi.fn(),
      push: vi.fn().mockResolvedValue({ source: 'driver', error: null, pushed: 1 }),
    };
    const usageMetering = { record: vi.fn(async () => undefined) } satisfies UsageMeteringHook;
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactory as unknown as ConnectorDriverFactory,
      { enqueueLlmJob: vi.fn() } as unknown as BullmqService,
      mutexMock().mutex as unknown as RedisMutexService,
      projectResolverMock() as unknown as ProjectContextResolver,
      usageMetering,
    );

    await service.scanOnce();

    expect(usageMetering.record).toHaveBeenCalledTimes(1);
    expect(driverFactory.push).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            run_result_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099',
            decision_output: 'allow',
          }),
        ],
      }),
    );
    expect(repo.recordOutputDelivery).toHaveBeenCalledWith(productionEventId, {
      successCount: 1,
      failedCount: 0,
    });
  });

  it('completes the canary when max sample stop condition is reached', async () => {
    const canary = lane({
      laneType: 'canary',
      runConfig: {
        rpmLimit: 60,
        tpmLimit: 60_000,
        concurrency: 1,
        stopConditions: { maxSamples: 1, maxDurationSeconds: null },
      },
    });
    const row = line({ inputConnectorType: 'webhook', canary });
    const repo = repoMock(row);
    repo.attachCompletedRunResults.mockImplementation(async (eventId: string) =>
      eventId === canaryEventId ? [completedRunResult()] : [],
    );
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactoryMock() as unknown as ConnectorDriverFactory,
      { enqueueLlmJob: vi.fn() } as unknown as BullmqService,
      mutexMock().mutex as unknown as RedisMutexService,
      projectResolverMock() as unknown as ProjectContextResolver,
    );

    await service.scanOnce();

    expect(repo.transitionLaneStatus).toHaveBeenCalledWith(
      canaryEventId,
      'completed',
      expect.objectContaining({
        terminalReason: null,
        metricsPatch: { completionReason: 'stop_conditions', stopCondition: 'maxSamples' },
      }),
    );
  });

  it('completes the canary when max duration stop condition is reached', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T10:02:00.000Z'));
    const canary = lane({
      laneType: 'canary',
      startedAt: new Date('2026-05-21T10:00:00.000Z'),
      runConfig: {
        rpmLimit: 60,
        tpmLimit: 60_000,
        concurrency: 1,
        stopConditions: { maxSamples: null, maxDurationSeconds: 60 },
      },
    });
    const row = line({ inputConnectorType: 'webhook', canary });
    const repo = repoMock(row);
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactoryMock() as unknown as ConnectorDriverFactory,
      { enqueueLlmJob: vi.fn() } as unknown as BullmqService,
      mutexMock().mutex as unknown as RedisMutexService,
      projectResolverMock() as unknown as ProjectContextResolver,
    );

    await service.scanOnce();

    expect(repo.transitionLaneStatus).toHaveBeenCalledWith(
      canaryEventId,
      'completed',
      expect.objectContaining({
        terminalReason: null,
        metricsPatch: { completionReason: 'stop_conditions', stopCondition: 'maxDurationSeconds' },
      }),
    );
  });

  it('completes the canary when the first stacked stop condition is reached', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T10:02:00.000Z'));
    const canary = lane({
      laneType: 'canary',
      startedAt: new Date('2026-05-21T10:00:00.000Z'),
      totalProcessed: 2,
      runConfig: {
        rpmLimit: 60,
        tpmLimit: 60_000,
        concurrency: 1,
        stopConditions: { maxSamples: 10, maxDurationSeconds: 60 },
      },
    });
    const row = line({ inputConnectorType: 'webhook', canary });
    const repo = repoMock(row);
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactoryMock() as unknown as ConnectorDriverFactory,
      { enqueueLlmJob: vi.fn() } as unknown as BullmqService,
      mutexMock().mutex as unknown as RedisMutexService,
      projectResolverMock() as unknown as ProjectContextResolver,
    );

    await service.scanOnce();

    expect(repo.transitionLaneStatus).toHaveBeenCalledWith(
      canaryEventId,
      'completed',
      expect.objectContaining({
        terminalReason: null,
        metricsPatch: { completionReason: 'stop_conditions', stopCondition: 'maxDurationSeconds' },
      }),
    );
  });

  it('pushes connector-specific output mapping results to each downstream connector', async () => {
    const redisConnectorId = '99999999-9999-4999-8999-000000000001';
    const kafkaConnectorId = '99999999-9999-4999-8999-000000000002';
    const row = line({
      inputConnectorType: 'webhook',
      production: lane({
        outputConnectorIds: [redisConnectorId, kafkaConnectorId],
        outputMapping: [
          {
            connectorId: redisConnectorId,
            outputMapping: [{ source: 'ok', target: 'redis.ok' }],
          },
          {
            connectorId: kafkaConnectorId,
            outputMapping: [{ source: 'decision_output', target: 'kafka.decision' }],
          },
        ],
      }),
    });
    const repo = repoMock(row);
    repo.attachCompletedRunResults.mockResolvedValue([completedRunResult()]);
    repo.listOutputConnectorsByIds.mockResolvedValue([
      { id: redisConnectorId, type: 'redis', direction: 'output', config: {}, configEncrypted: null },
      { id: kafkaConnectorId, type: 'kafka', direction: 'output', config: {}, configEncrypted: null },
    ]);
    const driverFactory = driverFactoryMock();
    driverFactory.push.mockResolvedValue({ pushed: 1, error: null });
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactory as unknown as ConnectorDriverFactory,
      { enqueueLlmJob: vi.fn() } as unknown as BullmqService,
      mutexMock().mutex as unknown as RedisMutexService,
      projectResolverMock() as unknown as ProjectContextResolver,
    );

    await service.scanOnce();

    expect(driverFactory.push).toHaveBeenCalledTimes(2);
    expect(driverFactory.push).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'redis',
        messages: [expect.objectContaining({ result: { redis: { ok: true } } })],
      }),
    );
    expect(driverFactory.push).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'kafka',
        messages: [expect.objectContaining({ result: { kafka: { decision: 'allow' } } })],
      }),
    );
    expect(repo.recordOutputDelivery).toHaveBeenCalledWith(productionEventId, { successCount: 2, failedCount: 0 });
  });

  it('does not push raw output to a connector excluded from the per-connector mapping (BUG A6)', async () => {
    const redisConnectorId = '99999999-9999-4999-8999-000000000001';
    const excludedConnectorId = '99999999-9999-4999-8999-000000000003';
    const row = line({
      inputConnectorType: 'webhook',
      production: lane({
        outputConnectorIds: [redisConnectorId, excludedConnectorId],
        // Per-connector mapping form: only redis is configured. The excluded
        // connector must receive nothing rather than the raw default envelope.
        outputMapping: [
          {
            connectorId: redisConnectorId,
            outputMapping: [{ source: 'ok', target: 'redis.ok' }],
          },
        ],
      }),
    });
    const repo = repoMock(row);
    repo.attachCompletedRunResults.mockResolvedValue([completedRunResult()]);
    repo.listOutputConnectorsByIds.mockResolvedValue([
      { id: redisConnectorId, type: 'redis', direction: 'output', config: {}, configEncrypted: null },
      { id: excludedConnectorId, type: 'kafka', direction: 'output', config: {}, configEncrypted: null },
    ]);
    const driverFactory = driverFactoryMock();
    driverFactory.push.mockResolvedValue({ pushed: 1, error: null });
    const service = new ReleaseRunnerService(
      repo as unknown as ReleaseRunnerRepository,
      driverFactory as unknown as ConnectorDriverFactory,
      { enqueueLlmJob: vi.fn() } as unknown as BullmqService,
      mutexMock().mutex as unknown as RedisMutexService,
      projectResolverMock() as unknown as ProjectContextResolver,
    );

    await service.scanOnce();

    // Only the mapped connector is pushed to; the excluded connector is skipped entirely.
    expect(driverFactory.push).toHaveBeenCalledTimes(1);
    expect(driverFactory.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'redis',
        messages: [expect.objectContaining({ result: { redis: { ok: true } } })],
      }),
    );
    expect(driverFactory.push).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'kafka' }));
    expect(repo.recordOutputDelivery).toHaveBeenCalledWith(productionEventId, { successCount: 1, failedCount: 0 });
  });
});
