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

  // orgId (override-only; undefined in OSS) is seeded from the resolved ProjectContext (the project's org is the
  // rate-limit bucket, SPEC 08 §3.7) and threaded into the workflow run input, so the worker can compose an
  // org-scoped rate-limit key without re-querying. Recovery hydrates the row's project before resume.
  async launch(experimentId: string, orgId?: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(experimentId, 'start', orgId);
  }

  async resume(experimentId: string, orgId?: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(experimentId, 'resume', orgId);
  }

  async retry(experimentId: string, orgId?: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(experimentId, 'retry', orgId);
  }

  async startWithWorkflowId(experimentId: string, workflowId: string, orgId?: string): Promise<string> {
    const handle = await DBOS.startWorkflow(this.workflow.runWorkflow, { workflowID: workflowId })(experimentId, orgId);
    this.logger.info({ experimentId, workflowId, handleId: handle.workflowID }, 'experiment_workflow_started');
    return workflowId;
  }

  private async startWorkflowWithIdSuffix(experimentId: string, kind: string, orgId?: string): Promise<string> {
    const workflowId = `exp:${experimentId}:${kind}:${Date.now()}`;
    await this.startWithWorkflowId(experimentId, workflowId, orgId);
    await this.repo.setDbosWorkflowId(experimentId, workflowId);
    return workflowId;
  }
}
