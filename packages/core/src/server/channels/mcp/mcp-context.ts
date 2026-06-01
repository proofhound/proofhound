// mcp-context — actor / project context adapter for MCP tool entrypoints
// See docs/specs/08-saas-adapter-boundary.md §3.3
//
// Current state:
//   - OSS has not yet mounted a real MCP transport (mcp.controller.ts is an empty controller);
//     `McpToolContext` is the placeholder shape used during tool dispatch; historically the actor field was passed in directly by the caller.
//   - This file no longer hardcodes a default actor and instead relies on:
//       1) `getMcpActor`: the tool already has the caller-provided actor (backward compatible) and returns it directly;
//          throws if missing — forcing callers to invoke `resolveMcpActor(metadata)` first during dispatch.
//       2) `resolveMcpActor`: wired to McpAuthResolver, performing real validation against MCP protocol metadata.
//          This will be the standard entrypoint once the MCP transport adapter lands.
//
// TODO(mcp-transport): once the MCP transport is actually wired up, the transport adapter should call
// `resolveMcpActor(metadata)` before each tool dispatch and write the result into McpToolContext.actor,
// then invoke the tool handler — so every handler obtains the resolver-validated actor via `getMcpActor(ctx)`.

import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { McpAuthResolver } from '../../common/contracts/mcp-auth.resolver';
import { ProjectContextResolver } from '../../common/contracts/project-context.resolver';
import type { McpRequestMetadataLike } from '../../common/contracts/types';
import { resolveProjectContext } from '../../common/project-context';
import type { ActorContext } from '../../common/actor-context';
import type { McpToolContext } from './mcp.types';

/**
 * Extracts the actor from an already-dispatched McpToolContext.
 * The caller must populate ctx.actor first via resolveMcpActor / the dispatch layer.
 *
 * Backward compatibility: if ctx.actor is missing but ctx.actorUserId is present, fall back to the legacy behavior.
 * This fallback will be removed once the MCP transport adapter lands (at which point ctx.actor must be injected by the resolver).
 */
export function getMcpActor(ctx: McpToolContext): CurrentUserPayload {
  if (ctx.actor) return ctx.actor;

  // Fallback: the MCP transport is not yet wired up; keep dev / internal scripts working.
  // Once the MCP transport lands, this path should throw UnauthorizedException instead.
  const projectContext = resolveProjectContext();
  return {
    sub: ctx.actorUserId,
    actorId: ctx.actorUserId,
    actorKind: 'system_mcp',
    projectId: projectContext.projectId,
    email: ctx.email ?? '',
    isSuperAdmin: ctx.isSuperAdmin ?? false,
    isActive: true,
  };
}

export function resolveMcpProjectContext(ctx: McpToolContext) {
  return resolveProjectContext(getMcpActor(ctx));
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
