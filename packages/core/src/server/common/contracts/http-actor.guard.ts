// HttpActorGuard — HTTP entry guard adapter extension point
// See docs/specs/08-adapter-extension-points.md §3
//
// HTTP controllers attach @UseGuards(HttpActorGuard). Nest treats class guards in metadata as
// enhancer injectables, so this class must be executable at runtime rather than an abstract shell.
//
// The guard's responsibility is to resolve the request actor and attach it to request.user
// as CurrentUserPayload. Real credential parsing lives in ActorContextResolver, so Controllers
// still don't reference a Local* concrete by name.

import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ActorContext, ProjectContext } from '../actor-context';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';
import { ActorContextResolver } from './actor-context.resolver';
import { ProjectContextResolver } from './project-context.resolver';
import { ProjectAccessDeniedError } from './project-context.resolver';

@Injectable()
export class HttpActorGuard implements CanActivate {
  constructor(
    private readonly resolver: ActorContextResolver,
    private readonly projectResolver: ProjectContextResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: CurrentUserPayload; projectContext: ProjectContext }>();

    const actor = await this.resolver.resolveFromHttp(request);
    request.user = toCurrentUserPayload(actor);

    // Resolve the request's ProjectContext via the DI resolver and attach it for @CurrentProject.
    // OSS LocalProjectContextResolver ignores the hint and returns LOCAL_PROJECT_CONTEXT; a replacement implementation reads
    // the X-Project-Id header and validates the actor's access to the project.
    try {
      request.projectContext = await this.projectResolver.resolve(actor, {
        projectIdHeader: readProjectIdHeader(request),
      });
    } catch (error) {
      if (error instanceof ProjectAccessDeniedError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
    return true;
  }
}

function readProjectIdHeader(request: Request): string | undefined {
  const raw = request.headers['x-project-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

export function toCurrentUserPayload(actor: ActorContext): CurrentUserPayload {
  const payload: CurrentUserPayload = {
    sub: actor.actorId,
    actorId: actor.actorId,
    actorKind: actor.actorKind,
    projectId: actor.projectId,
    // OSS user tokens have no email / role metadata; the field is kept for backward compatibility.
    // Override-specific claims should be exposed through a dedicated adapter/decorator, not read by OSS business code.
    email: '',
    isSuperAdmin: isOwnerActor(actor.actorKind),
    isActive: true,
  };
  if (actor.orgId !== undefined) payload.orgId = actor.orgId;
  return payload;
}

// OSS single-workspace: UI session user and API-token script both represent the local owner,
// so both bypass project-ownership checks via isSuperAdmin. system_* actors do NOT — they
// flow through access-control's SYSTEM_KINDS bypass instead.
function isOwnerActor(kind: ActorContext['actorKind']): boolean {
  return kind === 'local_user' || kind === 'script';
}
