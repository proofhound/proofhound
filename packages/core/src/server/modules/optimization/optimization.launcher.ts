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

  async launch(optimizationId: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(optimizationId, 'start');
  }

  async resume(optimizationId: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(optimizationId, 'resume');
  }

  async retry(optimizationId: string): Promise<string> {
    return this.startWorkflowWithIdSuffix(optimizationId, 'retry');
  }

  async startWithWorkflowId(optimizationId: string, workflowId: string): Promise<string> {
    const handle = await DBOS.startWorkflow(this.workflow.runWorkflow, {
      workflowID: workflowId,
    })(optimizationId);
    this.logger.info(
      { optimizationId, workflowId, handleId: handle.workflowID },
      'optimization_workflow_started',
    );
    return workflowId;
  }

  private async startWorkflowWithIdSuffix(optimizationId: string, kind: string): Promise<string> {
    const workflowId = `optimization:${optimizationId}:${kind}:${Date.now()}`;
    await this.startWithWorkflowId(optimizationId, workflowId);
    await this.repo.setDbosWorkflowId(optimizationId, workflowId);
    return workflowId;
  }
}
