// project-context — shortcut entrypoint for Controller / Service layer
// See docs/specs/08-adapter-extension-points.md §3.1
//
// `resolveProjectContext` is a legacy synchronous helper. The OSS default implementation always returns LOCAL_PROJECT_CONTEXT,
// and the sync signature is preserved to avoid rewriting every Controller.
// In a replacement implementation this must go through `ProjectContextProvider.resolveAsync(actor, hint)` (async version) —
// switched once PR §7 PR11 lands the X-Project-Id transport. This PR does not force a migration.
//
// `ProjectContextProvider` now internally delegates to `ProjectContextResolver` (registered as DI in LocalContractsModule).
// Synchronous direct calls still use the constant; the async path goes through the resolver, making it easy for a replacement implementation to override.

import { Injectable, Optional } from '@nestjs/common';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import type { ActorContext } from './actor-context';
import { ProjectContextResolver } from './contracts/project-context.resolver';
import type { ProjectContextHint } from './contracts/types';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

export type ProjectContextInput = ActorContext | CurrentUserPayload | undefined;

/**
 * Synchronous shortcut entrypoint; OSS always returns LOCAL_PROJECT_CONTEXT.
 * Do not extend the behavior of this function in new code — the real hint / actor resolution path goes through ProjectContextProvider.resolveAsync.
 */
export function resolveProjectContext(_input?: ProjectContextInput): ProjectContext {
  return LOCAL_PROJECT_CONTEXT;
}

@Injectable()
export class ProjectContextProvider {
  constructor(
    // Optional avoids manually wiring the resolver in unit tests that do not need it; the OSS prod path always has it injected.
    @Optional() private readonly resolver?: ProjectContextResolver,
  ) {}

  resolveProjectContext(input?: ProjectContextInput): ProjectContext {
    return resolveProjectContext(input);
  }

  /**
   * Async path via DI; a replacement RemoteProjectContextResolver reads hint / actor.claims here.
   * The OSS default implementation ignores the hint and always returns LOCAL_PROJECT_CONTEXT.
   */
  async resolveAsync(actor: ActorContext, hint?: ProjectContextHint): Promise<ProjectContext> {
    if (this.resolver) return this.resolver.resolve(actor, hint);
    return LOCAL_PROJECT_CONTEXT;
  }
}
