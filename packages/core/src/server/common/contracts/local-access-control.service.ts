// LocalAccessControlService — OSS default implementation of AccessControlService
// See docs/specs/08-saas-adapter-boundary.md §3.6
//
// OSS self-hosted single workspace: local_user (UI session) and system_* (MCP / webhook) pass everything;
// script (API token) is also a local-owner credential but cannot manage platform-level resources (e.g. token
// CRUD) to avoid token-laundering. `project` is ignored here; the SaaS RbacAccessControl reads it.

import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AccessAction } from '../access-control';
import type { ActorContext, ActorKind, ProjectContext } from '../actor-context';
import { AccessControlService } from './access-control.service';

// Actors produced by system entry resolvers (MCP / Webhook ingress). In OSS these bypass all access checks.
const SYSTEM_ACTOR_KINDS: ReadonlyArray<ActorKind> = ['system_mcp', 'system_webhook'];

@Injectable()
export class LocalAccessControlService extends AccessControlService {
  async assertCan(actor: ActorContext, _project: ProjectContext, action: AccessAction): Promise<void> {
    if (SYSTEM_ACTOR_KINDS.includes(actor.actorKind) || actor.actorKind === 'local_user') return;
    if (actor.actorKind === 'script') {
      if (action === 'platform_manage') throw new ForbiddenException('platform_manage_forbidden');
      return;
    }

    throw new ForbiddenException('actor_forbidden');
  }
}
