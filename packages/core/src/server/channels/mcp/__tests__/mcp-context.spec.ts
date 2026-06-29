import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ProjectContext } from '@proofhound/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '../../../common/actor-context';
import type { AccessControlService } from '../../../common/contracts/access-control.service';
import type { McpAuthResolver } from '../../../common/contracts/mcp-auth.resolver';
import {
  ProjectAccessDeniedError,
  type ProjectContextResolver,
} from '../../../common/contracts/project-context.resolver';
import type { McpRequestMetadataLike } from '../../../common/contracts/types';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { getMcpActor, McpDispatchContextFactory, resolveMcpProjectContext } from '../mcp-context';
import type { McpToolContext } from '../mcp.types';

const actor: CurrentUserPayload = {
  sub: 'tok-1',
  actorId: 'tok-1',
  actorKind: 'system_mcp',
  projectId: 'p-9',
  email: '',
  isSuperAdmin: false,
  isActive: true,
};

const actorContext: ActorContext = { actorId: 'tok-1', actorKind: 'system_mcp' };
const projectContext: ProjectContext = { projectId: 'p-9', source: 'local' };
const metadata: McpRequestMetadataLike = { headers: { authorization: 'Bearer ph_tok_1' } };

describe('mcp-context', () => {
  it('getMcpActor returns the resolver-injected actor', () => {
    expect(getMcpActor({ actorUserId: 'tok-1', actor })).toBe(actor);
  });

  it('getMcpActor throws missing_user_token when no actor was injected (no unauthenticated fallback)', () => {
    expect(() => getMcpActor({ actorUserId: 'tok-1' } as McpToolContext)).toThrow(UnauthorizedException);
  });

  it('resolveMcpProjectContext returns the actor-carried project', () => {
    expect(resolveMcpProjectContext({ actorUserId: 'tok-1', actor })).toEqual({ projectId: 'p-9', source: 'local' });
  });

  it('resolveMcpProjectContext carries orgId for org-pinned MCP actors (override rate-limit bucket, SPEC 08 §3.7)', () => {
    const orgActor: CurrentUserPayload = { ...actor, orgId: '00000000-0000-4000-8000-000000000111' };
    expect(resolveMcpProjectContext({ actorUserId: 'tok-1', actor: orgActor })).toEqual({
      projectId: 'p-9',
      source: 'local',
      orgId: '00000000-0000-4000-8000-000000000111',
    });
  });

  it('resolveMcpProjectContext prefers the resolved project orgId over the actor orgId', () => {
    const orgActor: CurrentUserPayload = { ...actor, orgId: 'actor-org' };
    const project: ProjectContext = { projectId: 'p-9', orgId: 'project-org', source: 'local' };

    expect(resolveMcpProjectContext({ actorUserId: 'tok-1', actor: orgActor, project })).toEqual(project);
  });

  it('McpDispatchContextFactory authorizes the MCP channel before returning context', async () => {
    const authResolver = { resolveFromMcp: vi.fn().mockResolvedValue(actorContext) };
    const projectResolver = { resolve: vi.fn().mockResolvedValue(projectContext) };
    const accessControl = { assertCan: vi.fn().mockResolvedValue(undefined) };
    const factory = new McpDispatchContextFactory(
      authResolver as unknown as McpAuthResolver,
      projectResolver as unknown as ProjectContextResolver,
      accessControl as unknown as AccessControlService,
    );

    const ctx = await factory.build(metadata);

    expect(authResolver.resolveFromMcp).toHaveBeenCalledWith(metadata);
    expect(projectResolver.resolve).toHaveBeenCalledWith(actorContext, { mcpMetadata: metadata });
    expect(accessControl.assertCan).toHaveBeenCalledWith(actorContext, projectContext, 'mcp_tool');
    expect(ctx.actor).toEqual({
      sub: 'tok-1',
      actorId: 'tok-1',
      actorKind: 'system_mcp',
      projectId: 'p-9',
      email: '',
      isSuperAdmin: false,
      isActive: true,
    });
    expect(ctx.project).toEqual(projectContext);
  });

  it('McpDispatchContextFactory preserves orgId for org-pinned MCP actors', async () => {
    const orgActorContext: ActorContext = { ...actorContext, orgId: '00000000-0000-4000-8000-000000000111' };
    const authResolver = { resolveFromMcp: vi.fn().mockResolvedValue(orgActorContext) };
    const projectResolver = { resolve: vi.fn().mockResolvedValue(projectContext) };
    const accessControl = { assertCan: vi.fn().mockResolvedValue(undefined) };
    const factory = new McpDispatchContextFactory(
      authResolver as unknown as McpAuthResolver,
      projectResolver as unknown as ProjectContextResolver,
      accessControl as unknown as AccessControlService,
    );

    const ctx = await factory.build(metadata);

    expect(ctx.actor).toMatchObject({
      actorId: 'tok-1',
      projectId: 'p-9',
      orgId: '00000000-0000-4000-8000-000000000111',
    });
  });

  it('McpDispatchContextFactory rejects dispatch when mcp_tool is denied', async () => {
    const authResolver = { resolveFromMcp: vi.fn().mockResolvedValue(actorContext) };
    const projectResolver = { resolve: vi.fn().mockResolvedValue(projectContext) };
    const accessControl = {
      assertCan: vi.fn().mockRejectedValue(new ForbiddenException('mcp_tool_forbidden')),
    };
    const factory = new McpDispatchContextFactory(
      authResolver as unknown as McpAuthResolver,
      projectResolver as unknown as ProjectContextResolver,
      accessControl as unknown as AccessControlService,
    );

    await expect(factory.build(metadata)).rejects.toThrow(ForbiddenException);
    expect(accessControl.assertCan).toHaveBeenCalledWith(actorContext, projectContext, 'mcp_tool');
  });

  it('McpDispatchContextFactory maps ProjectAccessDeniedError to 403 before channel authorization', async () => {
    const authResolver = { resolveFromMcp: vi.fn().mockResolvedValue(actorContext) };
    const projectResolver = { resolve: vi.fn().mockRejectedValue(new ProjectAccessDeniedError()) };
    const accessControl = { assertCan: vi.fn().mockResolvedValue(undefined) };
    const factory = new McpDispatchContextFactory(
      authResolver as unknown as McpAuthResolver,
      projectResolver as unknown as ProjectContextResolver,
      accessControl as unknown as AccessControlService,
    );

    await expect(factory.build(metadata)).rejects.toThrow(ForbiddenException);
    expect(projectResolver.resolve).toHaveBeenCalledWith(actorContext, { mcpMetadata: metadata });
    expect(accessControl.assertCan).not.toHaveBeenCalled();
  });
});
