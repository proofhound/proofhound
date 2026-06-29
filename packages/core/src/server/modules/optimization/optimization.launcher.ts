import { Injectable } from '@nestjs/common';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createLogger } from '@proofhound/logger';
import { OptimizationRepository } from './optimization.repository';
import { OptimizationWorkflowRegistrar } from './optimization.workflow';

@Injectable()
export class OptimizationLauncher {
  private readonly logger = createLogger('optimization.launcher', { service: 'server' });

  constructor(
    private readonly workflow: OptimizationWorkflowRegistrar,
    private readonly repo: OptimizationRepository,
  ) {}

  // orgId (override-only; undefined in OSS) is seeded from the resolved ProjectContext (the project's org is the
  // rate-limit bucket, SPEC 08 §3.7) and threaded into the workflow run input, so the worker can compose an
  // org-scoped rate-limit key without re-querying. Recovery hydrates the row's project before resume.
  async launch(optimizationId: string, orgId?: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(optimizationId, 'start', orgId);
  }

  async resume(optimizationId: string, orgId?: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(optimizationId, 'resume', orgId);
  }

  async retry(optimizationId: string, orgId?: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(optimizationId, 'retry', orgId);
  }

  async startWithWorkflowId(optimizationId: string, workflowId: string, orgId?: string): Promise<string> {
    const handle = await DBOS.startWorkflow(this.workflow.runWorkflow, {
      workflowID: workflowId,
    })(optimizationId, orgId);
    this.logger.info({ optimizationId, workflowId, handleId: handle.workflowID }, 'optimization_workflow_started');
    return workflowId;
  }

  private async startWorkflowWithIdSuffix(optimizationId: string, kind: string, orgId?: string): Promise<string> {
    const workflowId = `optimization:${optimizationId}:${kind}:${Date.now()}`;
    await this.startWithWorkflowId(optimizationId, workflowId, orgId);
    await this.repo.setDbosWorkflowId(optimizationId, workflowId);
    return workflowId;
  }
}
