// ProjectContextResolver — adapter extension point
// See docs/specs/08-adapter-extension-points.md §3.1
//
// The OSS default implementation `LocalProjectContextResolver` ignores all hints and always returns LOCAL_PROJECT_CONTEXT;
// in a replacement implementation, `RemoteProjectContextResolver` overrides this in a separate repo and resolves the
// real projectId from actor.claims / hint and validates access rights.

import type { ProjectContext } from '@proofhound/shared';
import type { ActorContext } from '../actor-context';
import type { ProjectContextHint } from './types';

export class ProjectAccessDeniedError extends Error {
  readonly code = 'project_access_denied';

  constructor(message = 'project_access_denied') {
    super(message);
    this.name = 'ProjectAccessDeniedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export abstract class ProjectContextResolver {
  abstract resolve(actor: ActorContext, hint?: ProjectContextHint): Promise<ProjectContext>;
}
