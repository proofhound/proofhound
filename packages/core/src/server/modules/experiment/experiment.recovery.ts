import type { OnApplicationBootstrap } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createLogger } from '@proofhound/logger';
import type { ActorContext } from '../../common/actor-context';
import { ProjectContextResolver } from '../../common/contracts/project-context.resolver';
import { ExperimentLauncher } from './experiment.launcher';
import { ExperimentRepository } from './experiment.repository';

const ACTIVE_DBOS_STATUSES = new Set(['PENDING', 'ENQUEUED', 'RUNNING']);

@Injectable()
export class ExperimentRecoveryService implements OnApplicationBootstrap {
  private readonly logger = createLogger('experiment.recovery', { service: 'server' });

  constructor(
    private readonly repo: ExperimentRepository,
    private readonly launcher: ExperimentLauncher,
    private readonly projectResolver: ProjectContextResolver,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.recoverActiveExperiments();
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'experiment_recovery_bootstrap_failed');
    }
  }

  async recoverActiveExperiments(): Promise<void> {
    const candidates = await this.repo.findActiveRunningWithWorkflow();
    if (candidates.length === 0) {
      this.logger.info({}, 'experiment_recovery_no_candidates');
      return;
    }

    for (const candidate of candidates) {
      const { experimentId, projectId, dbosWorkflowId } = candidate;
      let stillActive = false;
      try {
        const status = await DBOS.getWorkflowStatus(dbosWorkflowId);
        if (status && ACTIVE_DBOS_STATUSES.has(status.status)) {
          stillActive = true;
        }
      } catch (error) {
        this.logger.error(
          { experimentId, dbosWorkflowId, error: (error as Error).message },
          'experiment_recovery_status_lookup_failed',
        );
      }

      if (stillActive) {
        this.logger.info({ experimentId, dbosWorkflowId }, 'experiment_recovery_workflow_still_active');
        continue;
      }

      try {
        const project = await this.projectResolver.resolve(this.toRecoveryActor(experimentId, projectId), {
          projectId,
        });
        const newWorkflowId = await this.launcher.resume(experimentId, project.orgId);
        this.logger.info(
          { experimentId, projectId, orgId: project.orgId, dbosWorkflowId, newWorkflowId },
          'experiment_workflow_recovered',
        );
      } catch (error) {
        this.logger.error(
          { experimentId, dbosWorkflowId, error: (error as Error).message },
          'experiment_recovery_resume_failed',
        );
      }
    }
  }

  private toRecoveryActor(experimentId: string, projectId: string): ActorContext {
    return { actorId: experimentId, actorKind: 'system_workflow_recovery', projectId };
  }
}
