// @CurrentProject — HTTP Controller param decorator
// See docs/specs/08-adapter-extension-points.md §3.1
//
// `HttpActorGuard` resolves the request's ProjectContext (via the DI ProjectContextResolver) and
// attaches it to `request.projectContext`. This decorator is a thin synchronous reader of that value,
// so Controllers obtain the project without importing the resolver or the legacy sync helper.
//
// `extractCurrentProject` is exported separately so it can be unit-tested without the Nest param-decorator
// machinery.

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';

export function extractCurrentProject(_data: unknown, ctx: ExecutionContext): ProjectContext {
  const request = ctx.switchToHttp().getRequest<{ projectContext?: ProjectContext }>();
  // Fallback keeps unit tests / non-guarded routes working; guarded routes always have it set.
  return request.projectContext ?? LOCAL_PROJECT_CONTEXT;
}

export const CurrentProject = createParamDecorator(extractCurrentProject);
