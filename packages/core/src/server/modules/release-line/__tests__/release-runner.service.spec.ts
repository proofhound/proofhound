import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BullmqService } from '../../../infrastructure/orchestration/bullmq.service';
import type { RedisMutexService } from '../../../../shared/redis/redis-mutex.service';
import type { ConnectorDriverFactory } from '../../connector/connector.driver-factory';
import type { ProjectContextResolver } from '../../../common/contracts/project-context.resolver';
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
    releaseVariantId: null,
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
});
