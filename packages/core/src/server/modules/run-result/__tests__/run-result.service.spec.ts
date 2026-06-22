import { NotFoundException } from '@nestjs/common';
import type {
  ReleaseRunResultCleanupFilterDto,
  ReleaseRunResultCleanupInputDto,
  RunResultDetailDto,
  RunResultListQueryDto,
  RunResultReleaseListQueryDto,
} from '@proofhound/shared';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import type { ObjectStorageProvider } from '../../../common/contracts/object-storage.provider';
import type { ReleaseRunResultExportItem, RunResultRepository } from '../run-result.repository';
import { RunResultService } from '../run-result.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import { vi, type Mocked } from 'vitest';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const EXPERIMENT_ID = '22222222-2222-2222-2222-222222222222';
const RUN_RESULT_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';
const RELEASE_VERSION_ID = '55555555-5555-4555-8555-555555555555';

const localActor: CurrentUserPayload = {
  sub: USER_ID,
  email: 'a@b.com',
  isSuperAdmin: false,
  isActive: true,
};

const superAdminActor: CurrentUserPayload = {
  ...localActor,
  isSuperAdmin: true,
};

function buildRepo(overrides: Partial<Mocked<RunResultRepository>> = {}): Mocked<RunResultRepository> {
  return {
    aggregateExperiment: vi.fn(),
    aggregateExperimentLatency: vi.fn(),
    countBatchTerminal: vi.fn(),
    findAccessibleExperiment: vi.fn(),
    listByExperiment: vi.fn(),
    listByRelease: vi.fn(),
    listExperimentExportBatch: vi.fn(),
    listReleaseExportBatch: vi.fn(),
    previewReleaseCleanup: vi.fn(),
    deleteReleaseCleanup: vi.fn(),
    deleteReleaseRetentionCleanupBatch: vi.fn(),
    listReleaseRetentionCleanupTargets: vi.fn(),
    getDetailById: vi.fn(),
    ...overrides,
  } as unknown as Mocked<RunResultRepository>;
}

const defaultQuery: RunResultListQueryDto = {
  page: 1,
  pageSize: 20,
  sort: 'created_desc',
} as RunResultListQueryDto;
const defaultReleaseQuery = defaultQuery as RunResultReleaseListQueryDto;
const cleanupFilter: ReleaseRunResultCleanupFilterDto = {
  releaseVersionIds: [RELEASE_VERSION_ID],
  releaseVersionScope: 'exact',
};
const cleanupInput: ReleaseRunResultCleanupInputDto = {
  ...cleanupFilter,
  confirmation: 'delete_release_run_results',
};

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  let out = '';
  for await (const chunk of stream) {
    out += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  }
  return out;
}

describe('RunResultService', () => {
  describe('listExperimentRunResults', () => {
    it('throws NotFound when experiment / project pair has no access row', async () => {
      const repo = buildRepo({ findAccessibleExperiment: vi.fn().mockResolvedValue(null) });
      const service = new RunResultService(repo, new LocalAccessControlService());

      await expect(
        service.listExperimentRunResults(PROJECT_ID, EXPERIMENT_ID, localActor, defaultQuery),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.listByExperiment).not.toHaveBeenCalled();
    });

    it('delegates to repository when the experiment exists', async () => {
      const expected = { data: [], total: 0, page: 1, pageSize: 20 };
      const repo = buildRepo({
        findAccessibleExperiment: vi.fn().mockResolvedValue({
          experimentId: EXPERIMENT_ID,
          projectId: PROJECT_ID,
        }),
        listByExperiment: vi.fn().mockResolvedValue(expected),
      });
      const service = new RunResultService(repo, new LocalAccessControlService());

      const out = await service.listExperimentRunResults(PROJECT_ID, EXPERIMENT_ID, localActor, defaultQuery);
      expect(out).toBe(expected);
      expect(repo.listByExperiment).toHaveBeenCalledWith(EXPERIMENT_ID, defaultQuery);
    });

    it('delegates to repository when actor is the local actor', async () => {
      const expected = { data: [], total: 0, page: 1, pageSize: 20 };
      const repo = buildRepo({
        findAccessibleExperiment: vi.fn().mockResolvedValue({
          experimentId: EXPERIMENT_ID,
          projectId: PROJECT_ID,
        }),
        listByExperiment: vi.fn().mockResolvedValue(expected),
      });
      const service = new RunResultService(repo, new LocalAccessControlService());

      const out = await service.listExperimentRunResults(PROJECT_ID, EXPERIMENT_ID, localActor, defaultQuery);
      expect(out).toBe(expected);
      expect(repo.listByExperiment).toHaveBeenCalledWith(EXPERIMENT_ID, defaultQuery);
    });

    it('allows the local admin actor', async () => {
      const repo = buildRepo({
        findAccessibleExperiment: vi.fn().mockResolvedValue({
          experimentId: EXPERIMENT_ID,
          projectId: PROJECT_ID,
        }),
        listByExperiment: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
      });
      const service = new RunResultService(repo, new LocalAccessControlService());

      await expect(
        service.listExperimentRunResults(PROJECT_ID, EXPERIMENT_ID, superAdminActor, defaultQuery),
      ).resolves.toBeDefined();
    });
  });

  describe('getExperimentRunResult', () => {
    it('throws NotFound when detail is null', async () => {
      const repo = buildRepo({
        findAccessibleExperiment: vi.fn().mockResolvedValue({
          experimentId: EXPERIMENT_ID,
          projectId: PROJECT_ID,
        }),
        getDetailById: vi.fn().mockResolvedValue(null),
      });
      const service = new RunResultService(repo, new LocalAccessControlService());

      await expect(
        service.getExperimentRunResult(PROJECT_ID, EXPERIMENT_ID, RUN_RESULT_ID, localActor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns detail when repository resolves', async () => {
      const detail = { id: RUN_RESULT_ID, experimentId: EXPERIMENT_ID } as unknown;
      const repo = buildRepo({
        findAccessibleExperiment: vi.fn().mockResolvedValue({
          experimentId: EXPERIMENT_ID,
          projectId: PROJECT_ID,
        }),
        getDetailById: vi.fn().mockResolvedValue(detail),
      });
      const service = new RunResultService(repo, new LocalAccessControlService());

      const out = await service.getExperimentRunResult(PROJECT_ID, EXPERIMENT_ID, RUN_RESULT_ID, localActor);
      expect(out).toBe(detail);
      expect(repo.getDetailById).toHaveBeenCalledWith(EXPERIMENT_ID, RUN_RESULT_ID);
    });
  });

  describe('listReleaseRunResults', () => {
    it('delegates to repository with the project boundary', async () => {
      const expected = { data: [], total: 0, page: 1, pageSize: 20 };
      const repo = buildRepo({
        listByRelease: vi.fn().mockResolvedValue(expected),
      });
      const service = new RunResultService(repo, new LocalAccessControlService());

      const out = await service.listReleaseRunResults(PROJECT_ID, localActor, defaultReleaseQuery);
      expect(out).toBe(expected);
      expect(repo.listByRelease).toHaveBeenCalledWith(PROJECT_ID, defaultReleaseQuery);
    });
  });

  describe('exports', () => {
    it('streams experiment run results after experiment access is verified', async () => {
      const row = {
        id: RUN_RESULT_ID,
        projectId: PROJECT_ID,
        experimentId: EXPERIMENT_ID,
        sampleId: null,
        externalId: 'sample-1',
        status: 'success',
        judgmentStatus: 'correct',
        isCorrect: true,
        decisionOutput: 'yes',
        expectedOutput: 'yes',
        inputPreview: 'question',
        outputPreview: 'yes',
        renderedPrompt: 'prompt',
        inputVariables: { question: 'question' },
        rawResponse: 'yes',
        parsedOutput: { answer: 'yes' },
        errorClass: null,
        errorMessage: null,
        latencyMs: 12,
        inputTokens: 3,
        outputTokens: 4,
        costEstimate: 0.001,
        attempt: 1,
        createdAt: '2026-06-01T00:00:00.000Z',
      } as unknown as RunResultDetailDto;
      const repo = buildRepo({
        findAccessibleExperiment: vi.fn().mockResolvedValue({
          experimentId: EXPERIMENT_ID,
          projectId: PROJECT_ID,
        }),
        listExperimentExportBatch: vi.fn().mockResolvedValue({ rows: [row], nextCursor: null }),
      });
      const service = new RunResultService(repo, new LocalAccessControlService());

      const file = await service.exportExperimentRunResults(PROJECT_ID, EXPERIMENT_ID, localActor, 'csv', defaultQuery);
      const content = await readStream(file.stream);

      expect(file.fileName).toBe(`experiment-run-results-${EXPERIMENT_ID}.csv`);
      expect(content).toContain('"id","project_id","experiment_id"');
      expect(content).toContain(`"${RUN_RESULT_ID}","${PROJECT_ID}","${EXPERIMENT_ID}"`);
      expect(repo.findAccessibleExperiment).toHaveBeenCalledWith(PROJECT_ID, EXPERIMENT_ID, USER_ID, false);
      expect(repo.listExperimentExportBatch).toHaveBeenCalledWith(
        EXPERIMENT_ID,
        defaultQuery,
        expect.objectContaining({ cursor: null, limit: expect.any(Number) }),
      );
    });

    it('streams release run results as JSONL with the release filter', async () => {
      const row = {
        id: RUN_RESULT_ID,
        projectId: PROJECT_ID,
        source: 'release',
        sourceId: '55555555-5555-4555-8555-555555555555',
        eventId: '55555555-5555-4555-8555-555555555555',
        lane: 'production',
        releaseVersionId: null,
        releaseVersionLabel: null,
        releaseVersionKind: null,
        externalId: 'request-1',
        promptName: 'assistant',
        promptVersionId: '66666666-6666-4666-8666-666666666666',
        promptVersionNumber: 7,
        modelId: '77777777-7777-4777-8777-777777777777',
        modelName: 'gpt-test',
        modelProvider: 'openai',
        status: 'success',
        judgmentStatus: null,
        isCorrect: null,
        decisionOutput: 'ok',
        renderedPrompt: 'prompt',
        inputVariables: { text: 'hello' },
        rawResponse: 'ok',
        parsedOutput: { ok: true },
        errorClass: null,
        errorMessage: null,
        latencyMs: 20,
        inputTokens: 5,
        outputTokens: 6,
        costEstimate: 0.002,
        attempt: 1,
        createdAt: '2026-06-01T00:00:00.000Z',
      } as unknown as ReleaseRunResultExportItem;
      const repo = buildRepo({
        listReleaseExportBatch: vi.fn().mockResolvedValue({ rows: [row], nextCursor: null }),
      });
      const service = new RunResultService(repo, new LocalAccessControlService());

      const file = await service.exportReleaseRunResults(PROJECT_ID, localActor, 'jsonl', defaultReleaseQuery);
      const [line] = (await readStream(file.stream)).trim().split('\n');
      const parsed = JSON.parse(line ?? '{}') as Record<string, unknown>;

      expect(file.fileName).toBe(`release-run-results-${PROJECT_ID}.jsonl`);
      expect(parsed['id']).toBe(RUN_RESULT_ID);
      expect(parsed['source']).toBe('release');
      expect(repo.listReleaseExportBatch).toHaveBeenCalledWith(
        PROJECT_ID,
        defaultReleaseQuery,
        expect.objectContaining({ cursor: null, limit: expect.any(Number) }),
      );
    });
  });

  describe('release cleanup', () => {
    it('previews release cleanup with read access', async () => {
      const expected = {
        runResults: 2,
        annotations: 1,
        runResultRowBytes: 100,
        annotationBytes: 10,
        dbBytes: 110,
        objectBytes: 200,
        reclaimableObjectBytes: 200,
        deferredObjectBytes: 0,
        estimatedMatchedBytes: 310,
        estimatedReclaimableBytes: 310,
      };
      const repo = buildRepo({ previewReleaseCleanup: vi.fn().mockResolvedValue(expected) });
      const service = new RunResultService(repo, new LocalAccessControlService());

      const out = await service.previewReleaseRunResultCleanup(PROJECT_ID, localActor, cleanupFilter);
      expect(out).toBe(expected);
      expect(repo.previewReleaseCleanup).toHaveBeenCalledWith(PROJECT_ID, cleanupFilter);
    });

    it('deletes release cleanup payload refs after the DB transaction result', async () => {
      const payloadRef = {
        provider: 'test',
        key: 'run_result_shard/source/gen1/shard-0.jsonl.gz',
        bytes: 128,
        resourceType: 'run_result_shard',
        resourceId: '55555555-5555-4555-8555-555555555555',
      };
      const repo = buildRepo({
        deleteReleaseCleanup: vi.fn().mockResolvedValue({
          runResults: 1,
          annotations: 0,
          runResultRowBytes: 64,
          annotationBytes: 0,
          dbBytes: 64,
          objectBytes: 128,
          reclaimableObjectBytes: 128,
          deferredObjectBytes: 0,
          estimatedMatchedBytes: 192,
          estimatedReclaimableBytes: 192,
          payloadRefs: [payloadRef],
        }),
      });
      const objectStorage = {
        isEnabled: () => true,
        deleteObjects: vi.fn().mockResolvedValue(undefined),
      };
      const service = new RunResultService(
        repo,
        new LocalAccessControlService(),
        objectStorage as unknown as ObjectStorageProvider,
      );

      const out = await service.cleanupReleaseRunResults(PROJECT_ID, localActor, cleanupInput);
      expect(out).toEqual({
        runResults: 1,
        annotations: 0,
        runResultRowBytes: 64,
        annotationBytes: 0,
        dbBytes: 64,
        objectBytes: 128,
        reclaimableObjectBytes: 128,
        deferredObjectBytes: 0,
        estimatedMatchedBytes: 192,
        estimatedReclaimableBytes: 192,
      });
      expect(objectStorage.deleteObjects).toHaveBeenCalledWith([payloadRef]);
    });

    it('rejects cleanup when the date range is inverted', async () => {
      const repo = buildRepo();
      const service = new RunResultService(repo, new LocalAccessControlService());

      await expect(
        service.previewReleaseRunResultCleanup(PROJECT_ID, localActor, {
          releaseVersionIds: [RELEASE_VERSION_ID],
          releaseVersionScope: 'exact',
          from: '2026-06-02T00:00:00.000Z',
          to: '2026-06-01T00:00:00.000Z',
        }),
      ).rejects.toThrow('run_result_cleanup_invalid_time_range');
      expect(repo.previewReleaseCleanup).not.toHaveBeenCalled();
    });

    it('rejects manual cleanup without a release version filter', async () => {
      const repo = buildRepo();
      const service = new RunResultService(repo, new LocalAccessControlService());

      await expect(
        service.previewReleaseRunResultCleanup(PROJECT_ID, localActor, {
          releaseVersionScope: 'exact',
        }),
      ).rejects.toThrow('run_result_cleanup_release_version_required');
      expect(repo.previewReleaseCleanup).not.toHaveBeenCalled();
    });
  });

  describe('release retention sweep', () => {
    it('uses the repository retention batch and deletes payload refs after commit', async () => {
      const payloadRef = {
        provider: 'test',
        key: 'run_result_shard/source/release/shard-0.jsonl.gz',
        bytes: 256,
        resourceType: 'run_result_shard',
        resourceId: '55555555-5555-4555-8555-555555555555',
      };
      const repo = buildRepo({
        deleteReleaseRetentionCleanupBatch: vi.fn().mockResolvedValue({
          lockAcquired: true,
          targets: 1,
          cleanups: [
            {
              target: {
                projectId: PROJECT_ID,
                sourceId: '66666666-6666-4666-8666-666666666666',
                retentionDays: 30,
                cutoff: '2026-06-01T00:00:00.000Z',
              },
              impact: {
                runResults: 2,
                annotations: 1,
                runResultRowBytes: 100,
                annotationBytes: 10,
                dbBytes: 110,
                objectBytes: 256,
                reclaimableObjectBytes: 256,
                deferredObjectBytes: 0,
                estimatedMatchedBytes: 366,
                estimatedReclaimableBytes: 366,
              },
              payloadRefs: [payloadRef],
            },
          ],
        }),
      });
      const objectStorage = {
        isEnabled: () => true,
        deleteObjects: vi.fn().mockResolvedValue(undefined),
      };
      const service = new RunResultService(
        repo,
        new LocalAccessControlService(),
        objectStorage as unknown as ObjectStorageProvider,
      );

      const now = new Date('2026-07-01T00:00:00.000Z');
      const out = await service.sweepReleaseRunResultRetention(now);

      expect(repo.deleteReleaseRetentionCleanupBatch).toHaveBeenCalledWith(now);
      expect(out).toEqual({ targets: 1, runResults: 2, estimatedReclaimableBytes: 366 });
      expect(objectStorage.deleteObjects).toHaveBeenCalledWith([payloadRef]);
    });

    it('skips retention cleanup when another replica holds the sweep lock', async () => {
      const repo = buildRepo({
        deleteReleaseRetentionCleanupBatch: vi.fn().mockResolvedValue({
          lockAcquired: false,
          targets: 0,
          cleanups: [],
        }),
      });
      const objectStorage = {
        isEnabled: () => true,
        deleteObjects: vi.fn().mockResolvedValue(undefined),
      };
      const service = new RunResultService(
        repo,
        new LocalAccessControlService(),
        objectStorage as unknown as ObjectStorageProvider,
      );

      await expect(service.sweepReleaseRunResultRetention()).resolves.toEqual({
        targets: 0,
        runResults: 0,
        estimatedReclaimableBytes: 0,
      });
      expect(objectStorage.deleteObjects).not.toHaveBeenCalled();
    });
  });
});
