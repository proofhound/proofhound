// HttpActorGuard — HTTP entry guard adapter extension point
// See docs/specs/08-saas-adapter-boundary.md §3
//
// HTTP controllers attach @UseGuards(HttpActorGuard). Nest treats class guards in metadata as
// enhancer injectables, so this class must be executable at runtime rather than an abstract shell.
//
// The guard's responsibility is to resolve the request actor and attach it to request.user
// as CurrentUserPayload. Real credential parsing lives in ActorContextResolver, so Controllers
// still don't reference a Local* concrete by name.

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ActorContext } from '../actor-context';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';
import { ActorContextResolver } from './actor-context.resolver';

@Injectable()
export class HttpActorGuard implements CanActivate {
  constructor(private readonly resolver: ActorContextResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: CurrentUserPayload }>();

    const actor = await this.resolver.resolveFromHttp(request);
    request.user = toCurrentUserPayload(actor);
    return true;
  }
}

export function toCurrentUserPayload(actor: ActorContext): CurrentUserPayload {
  return {
    sub: actor.actorId,
    actorId: actor.actorId,
    actorKind: actor.actorKind,
    projectId: actor.projectId,
    // OSS user tokens have no email / role metadata; the field is kept for backward compatibility.
    // SaaS-specific claims should be exposed through a dedicated adapter/decorator, not read by OSS business code.
    email: '',
    isSuperAdmin: isOwnerActor(actor.actorKind),
    isActive: true,
  };
}

// OSS single-workspace: UI session user and API-token script both represent the local owner,
// so both bypass project-ownership checks via isSuperAdmin. system_* actors do NOT — they
// flow through access-control's SYSTEM_KINDS bypass instead.
function isOwnerActor(kind: ActorContext['actorKind']): boolean {
  return kind === 'local_user' || kind === 'script';
}
