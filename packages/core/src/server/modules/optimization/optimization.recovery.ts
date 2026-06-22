import type { OnApplicationBootstrap } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createLogger } from '@proofhound/logger';
import type { ActorContext } from '../../common/actor-context';
import { ProjectContextResolver } from '../../common/contracts/project-context.resolver';
import { OptimizationLauncher } from './optimization.launcher';
import { OptimizationRepository } from './optimization.repository';

const ACTIVE_DBOS_STATUSES = new Set(['PENDING', 'ENQUEUED', 'RUNNING']);

@Injectable()
export class OptimizationRecoveryService implements OnApplicationBootstrap {
  private readonly logger = createLogger('optimization.recovery', { service: 'server' });

  constructor(
    private readonly repo: OptimizationRepository,
    private readonly launcher: OptimizationLauncher,
    private readonly projectResolver: ProjectContextResolver,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.recoverActiveOptimizations();
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'optimization_recovery_bootstrap_failed');
    }
  }

  async recoverActiveOptimizations(): Promise<void> {
    const candidates = await this.repo.findActiveRunningWithWorkflow();
    if (candidates.length === 0) {
      this.logger.info({}, 'optimization_recovery_no_candidates');
      return;
    }

    for (const candidate of candidates) {
      const { optimizationId, projectId, dbosWorkflowId } = candidate;
      let stillActive = false;
      try {
        const status = await DBOS.getWorkflowStatus(dbosWorkflowId);
        if (status && ACTIVE_DBOS_STATUSES.has(status.status)) {
          stillActive = true;
        }
      } catch (error) {
        this.logger.error(
          { optimizationId, dbosWorkflowId, error: (error as Error).message },
          'optimization_recovery_status_lookup_failed',
        );
      }

      if (stillActive) {
        this.logger.info({ optimizationId, dbosWorkflowId }, 'optimization_recovery_workflow_still_active');
        continue;
      }

      try {
        const project = await this.projectResolver.resolve(this.toRecoveryActor(optimizationId, projectId), {
          projectId,
        });
        const newWorkflowId = await this.launcher.resume(optimizationId, project.orgId);
        this.logger.info(
          { optimizationId, projectId, orgId: project.orgId, dbosWorkflowId, newWorkflowId },
          'optimization_workflow_recovered',
        );
      } catch (error) {
        this.logger.error(
          { optimizationId, dbosWorkflowId, error: (error as Error).message },
          'optimization_recovery_resume_failed',
        );
      }
    }
  }

  private toRecoveryActor(optimizationId: string, projectId: string): ActorContext {
    return { actorId: optimizationId, actorKind: 'system_workflow_recovery', projectId };
  }
}
