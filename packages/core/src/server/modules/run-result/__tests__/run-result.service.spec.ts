import { NotFoundException } from '@nestjs/common';
import type { RunResultListQueryDto, RunResultReleaseListQueryDto } from '@proofhound/shared';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import type { RunResultRepository } from '../run-result.repository';
import { RunResultService } from '../run-result.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import { vi, type Mocked } from 'vitest';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const EXPERIMENT_ID = '22222222-2222-2222-2222-222222222222';
const RUN_RESULT_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';

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
});
