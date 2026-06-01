import { Injectable } from '@nestjs/common';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createLogger } from '@proofhound/logger';
import { ExperimentRepository } from './experiment.repository';
import { ExperimentWorkflowRegistrar } from './experiment.workflow';

@Injectable()
export class ExperimentLauncher {
  private readonly logger = createLogger('experiment.launcher', { service: 'server' });

  constructor(
    private readonly workflow: ExperimentWorkflowRegistrar,
    private readonly repo: ExperimentRepository,
  ) {}

  async launch(experimentId: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(experimentId, 'start');
  }

  async resume(experimentId: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(experimentId, 'resume');
  }

  async retry(experimentId: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(experimentId, 'retry');
  }

  async startWithWorkflowId(experimentId: string, workflowId: string): Promise<string> {
    const handle = await DBOS.startWorkflow(this.workflow.runWorkflow, { workflowID: workflowId })(experimentId);
    this.logger.info({ experimentId, workflowId, handleId: handle.workflowID }, 'experiment_workflow_started');
    return workflowId;
  }

  private async startWorkflowWithIdSuffix(experimentId: string, kind: string): Promise<string> {
    const workflowId = `exp:${experimentId}:${kind}:${Date.now()}`;
    await this.startWithWorkflowId(experimentId, workflowId);
    await this.repo.setDbosWorkflowId(experimentId, workflowId);
    return workflowId;
  }
}
