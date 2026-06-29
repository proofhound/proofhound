// LocalProjectContextResolver — OSS default implementation
// See docs/specs/08-adapter-extension-points.md §3.1
//
// OSS has a single workspace; ignore all hints and always return LOCAL_PROJECT_CONTEXT.
// A replacement implementation overrides this with RemoteProjectContextResolver in a separate repo.

import { Injectable } from '@nestjs/common';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import type { ActorContext } from '../actor-context';
import { ProjectContextResolver } from './project-context.resolver';
import type { ProjectContextHint } from './types';

@Injectable()
export class LocalProjectContextResolver extends ProjectContextResolver {
  async resolve(_actor: ActorContext, _hint?: ProjectContextHint): Promise<ProjectContext> {
    return LOCAL_PROJECT_CONTEXT;
  }
}
