// mcp-context — actor / project context adapter for MCP tool entrypoints
// See docs/specs/08-saas-adapter-boundary.md §3.3 and docs/specs/09-mcp-server.md.
//
// The MCP transport (mcp.transport.ts) authenticates each request and builds the McpToolContext via
// `McpDispatchContextFactory.build(metadata)` BEFORE dispatching a tool, so every tool handler obtains
// the resolver-validated actor through `getMcpActor(ctx)`. There is no unauthenticated fallback.

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { McpAuthResolver } from '../../common/contracts/mcp-auth.resolver';
import { ProjectContextResolver } from '../../common/contracts/project-context.resolver';
import type { McpRequestMetadataLike } from '../../common/contracts/types';
import type { ActorContext } from '../../common/actor-context';
import type { McpToolContext } from './mcp.types';

/**
 * Extracts the resolver-validated actor from a dispatched McpToolContext. The MCP transport
 * (mcp.transport.ts) always injects `ctx.actor` via McpDispatchContextFactory; a missing actor means
 * the request was not authenticated, so this throws rather than synthesizing a default.
 */
export function getMcpActor(ctx: McpToolContext): CurrentUserPayload {
  if (!ctx.actor) throw new UnauthorizedException('missing_user_token');
  return ctx.actor;
}

/** The ProjectContext carried by the validated actor (resolved by ProjectContextResolver at dispatch). */
export function resolveMcpProjectContext(ctx: McpToolContext): ProjectContext {
  const actor = getMcpActor(ctx);
  return { projectId: actor.projectId ?? LOCAL_PROJECT_CONTEXT.projectId, source: 'local' };
}

/**
 * Used during MCP transport adapter dispatch: pull the token from protocol-level metadata,
 * validate via McpAuthResolver → resolve ActorContext → resolve ProjectContext,
 * and return the assembled McpToolContext.
 */
@Injectable()
export class McpDispatchContextFactory {
  constructor(
    private readonly authResolver: McpAuthResolver,
    private readonly projectResolver: ProjectContextResolver,
  ) {}

  async build(metadata: McpRequestMetadataLike): Promise<McpToolContext> {
    const actor = await this.authResolver.resolveFromMcp(metadata);
    const project = await this.projectResolver.resolve(actor, { mcpMetadata: metadata });
    const payload = toCurrentUserPayload(actor, project.projectId);
    return {
      actorUserId: actor.actorId,
      actor: payload,
      email: payload.email,
      isSuperAdmin: payload.isSuperAdmin,
    };
  }
}

function toCurrentUserPayload(actor: ActorContext, projectId: string): CurrentUserPayload {
  return {
    sub: actor.actorId,
    actorId: actor.actorId,
    actorKind: actor.actorKind,
    projectId,
    email: '',
    // MCP actors are system_mcp; the MCP channel grants no admin-bypass to the project layer
    // (system_* actors flow through access-control's SYSTEM_KINDS bypass instead).
    isSuperAdmin: false,
    isActive: true,
  };
}

// Re-export so the MCP transport adapter can import the concrete 401 type directly
export { UnauthorizedException };
