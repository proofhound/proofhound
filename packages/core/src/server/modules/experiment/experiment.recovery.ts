import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createLogger } from '@proofhound/logger';
import { ExperimentLauncher } from './experiment.launcher';
import { ExperimentRepository } from './experiment.repository';

const ACTIVE_DBOS_STATUSES = new Set(['PENDING', 'ENQUEUED', 'RUNNING']);

@Injectable()
export class ExperimentRecoveryService implements OnApplicationBootstrap {
  private readonly logger = createLogger('experiment.recovery', { service: 'server' });

  constructor(
    private readonly repo: ExperimentRepository,
    private readonly launcher: ExperimentLauncher,
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
      const { experimentId, dbosWorkflowId } = candidate;
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
        const newWorkflowId = await this.launcher.resume(experimentId);
        this.logger.info(
          { experimentId, dbosWorkflowId, newWorkflowId },
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
}
