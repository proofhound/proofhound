// WorkflowAuthorizationHook — adapter extension point
// See docs/specs/08-saas-adapter-boundary.md §3.8
//
// Called once before a DBOS workflow / BullMQ job is started or enqueued, to validate whether the
// actor may start that workflow kind on that project. This is the only OSS-trunk boundary where the
// entry's authentication is trusted: once a payload is written it is considered already authorized,
// and the worker / runner do not re-authorize.
//
// OSS default `LocalWorkflowAuthorizationHook` passes everything (the single local project authorizes
// all workflow starts). SaaS `RbacWorkflowAuthorizationHook` validates the actor's role on the project.
//
// `WorkflowKind` is reconciled with the workflow / queue list in docs/specs/03-orchestration.md:
// DBOS workflows `ExperimentWorkflow` / `OptimizationWorkflow`, BullMQ queues `llm` / `probe`, and the
// in-server release runner (`release`). It is a coarse enum and is not coupled to roles or resource ids.

import type { ActorContext, ProjectContext } from '../actor-context';

export type WorkflowKind = 'experiment' | 'optimization' | 'release' | 'llm' | 'probe';

export abstract class WorkflowAuthorizationHook {
  abstract assertCanStart(actor: ActorContext, project: ProjectContext, workflow: WorkflowKind): Promise<void>;
}

export class LocalWorkflowAuthorizationHook extends WorkflowAuthorizationHook {
  async assertCanStart(_actor: ActorContext, _project: ProjectContext, _workflow: WorkflowKind): Promise<void> {
    // OSS no-op: the single local project authorizes all workflow starts.
  }
}
