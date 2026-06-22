import { DBOS } from '@dbos-inc/dbos-sdk';
import type * as DbosSdk from '@dbos-inc/dbos-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectContextResolver } from '../../../common/contracts/project-context.resolver';
import type { ExperimentLauncher } from '../experiment.launcher';
import type { ExperimentRepository } from '../experiment.repository';
import { ExperimentRecoveryService } from '../experiment.recovery';

const getWorkflowStatusMock = vi.hoisted(() => vi.fn());

vi.mock('@dbos-inc/dbos-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof DbosSdk>();
  return {
    ...actual,
    DBOS: {
      ...actual.DBOS,
      getWorkflowStatus: getWorkflowStatusMock,
    },
  };
});

describe('ExperimentRecoveryService', () => {
  it('hydrates project orgId before resuming an inactive workflow', async () => {
    vi.mocked(DBOS.getWorkflowStatus).mockResolvedValueOnce({ status: 'SUCCESS' } as never);
    const repo = {
      findActiveRunningWithWorkflow: vi.fn().mockResolvedValue([
        {
          experimentId: '22222222-2222-4222-8222-222222222222',
          projectId: '11111111-1111-4111-8111-111111111111',
          dbosWorkflowId: 'exp-old',
        },
      ]),
    } as unknown as ExperimentRepository;
    const launcher = { resume: vi.fn().mockResolvedValue('exp-new') } as unknown as ExperimentLauncher;
    const projectResolver = {
      resolve: vi.fn().mockResolvedValue({
        projectId: '11111111-1111-4111-8111-111111111111',
        orgId: '33333333-3333-4333-8333-333333333333',
        source: 'local',
      }),
    } as unknown as ProjectContextResolver;
    const service = new ExperimentRecoveryService(repo, launcher, projectResolver);

    await service.recoverActiveExperiments();

    expect(projectResolver.resolve).toHaveBeenCalledWith(
      {
        actorId: '22222222-2222-4222-8222-222222222222',
        actorKind: 'system_workflow_recovery',
        projectId: '11111111-1111-4111-8111-111111111111',
      },
      { projectId: '11111111-1111-4111-8111-111111111111' },
    );
    expect(launcher.resume).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    );
  });
});
