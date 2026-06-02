import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '../../actor-context';
import type { ActorContextResolver } from '../actor-context.resolver';
import { ProjectAccessDeniedError, type ProjectContextResolver } from '../project-context.resolver';
import { HttpActorGuard } from '../http-actor.guard';

function buildContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function buildGuard(
  actor: ActorContext | Error,
  projectResult: ProjectContext | Error = LOCAL_PROJECT_CONTEXT,
): {
  guard: HttpActorGuard;
  projectResolve: ReturnType<typeof vi.fn>;
} {
  const resolver: Pick<ActorContextResolver, 'resolveFromHttp' | 'resolveFromUserToken'> = {
    resolveFromHttp:
      actor instanceof Error ? vi.fn().mockRejectedValue(actor) : vi.fn().mockResolvedValue(actor),
    resolveFromUserToken: vi.fn(),
  };
  const projectResolve =
    projectResult instanceof Error
      ? vi.fn().mockRejectedValue(projectResult)
      : vi.fn().mockResolvedValue(projectResult);
  const projectResolver = { resolve: projectResolve } as unknown as ProjectContextResolver;
  return { guard: new HttpActorGuard(resolver as ActorContextResolver, projectResolver), projectResolve };
}

describe('HttpActorGuard', () => {
  it('success path: attaches request.user as CurrentUserPayload', async () => {
    const { guard } = buildGuard({ actorId: 'tok-1', actorKind: 'script' });
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    const ok = await guard.canActivate(buildContext(req));

    expect(ok).toBe(true);
    expect(req.user).toEqual({
      sub: 'tok-1',
      actorId: 'tok-1',
      actorKind: 'script',
      projectId: undefined,
      email: '',
      // script actor is an owner-created API token; OSS treats it as super admin
      isSuperAdmin: true,
      isActive: true,
    });
  });

  it('resolves and attaches request.projectContext via ProjectContextResolver with the X-Project-Id hint', async () => {
    const { guard, projectResolve } = buildGuard({ actorId: 'tok-1', actorKind: 'script' });
    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer x', 'x-project-id': 'p-1' },
    };
    await guard.canActivate(buildContext(req));

    expect(req.projectContext).toBe(LOCAL_PROJECT_CONTEXT);
    expect(projectResolve).toHaveBeenCalledWith(
      { actorId: 'tok-1', actorKind: 'script' },
      { projectIdHeader: 'p-1' },
    );
  });

  it('does not swallow the 401 thrown by the resolver', async () => {
    const { guard } = buildGuard(new UnauthorizedException('invalid_user_token'));
    await expect(guard.canActivate(buildContext({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('maps ProjectAccessDeniedError from ProjectContextResolver to 403', async () => {
    const { guard, projectResolve } = buildGuard(
      { actorId: 'tok-1', actorKind: 'script' },
      new ProjectAccessDeniedError('project_access_denied'),
    );
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x', 'x-project-id': 'p-2' } };

    await expect(guard.canActivate(buildContext(req))).rejects.toBeInstanceOf(ForbiddenException);
    expect(projectResolve).toHaveBeenCalledWith(
      { actorId: 'tok-1', actorKind: 'script' },
      { projectIdHeader: 'p-2' },
    );
    expect(req.projectContext).toBeUndefined();
  });

  it('local_user actor (UI session) maps to isSuperAdmin=true', async () => {
    const { guard } = buildGuard({ actorId: 'admin-1', actorKind: 'local_user' });
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await guard.canActivate(buildContext(req));
    expect((req.user as { isSuperAdmin: boolean }).isSuperAdmin).toBe(true);
  });

  it('system_mcp actor maps to isSuperAdmin=false (system actors use the access-control system bypass)', async () => {
    const { guard } = buildGuard({ actorId: 'mcp-1', actorKind: 'system_mcp' });
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await guard.canActivate(buildContext(req));
    expect((req.user as { isSuperAdmin: boolean }).isSuperAdmin).toBe(false);
  });
});
