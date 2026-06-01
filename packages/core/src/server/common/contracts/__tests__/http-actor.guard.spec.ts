import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ActorContextResolver } from '../actor-context.resolver';
import { HttpActorGuard } from '../http-actor.guard';

function buildContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('HttpActorGuard', () => {
  it('success path: attaches request.user as CurrentUserPayload', async () => {
    const resolver: Pick<ActorContextResolver, 'resolveFromHttp' | 'resolveFromUserToken'> = {
      resolveFromHttp: vi.fn().mockResolvedValue({ actorId: 'tok-1', actorKind: 'script' }),
      resolveFromUserToken: vi.fn(),
    };
    const guard = new HttpActorGuard(resolver as ActorContextResolver);
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

  it('does not swallow the 401 thrown by the resolver', async () => {
    const resolver: Pick<ActorContextResolver, 'resolveFromHttp' | 'resolveFromUserToken'> = {
      resolveFromHttp: vi.fn().mockRejectedValue(new UnauthorizedException('invalid_user_token')),
      resolveFromUserToken: vi.fn(),
    };
    const guard = new HttpActorGuard(resolver as ActorContextResolver);
    await expect(guard.canActivate(buildContext({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('local_user actor (UI session) maps to isSuperAdmin=true', async () => {
    const resolver: Pick<ActorContextResolver, 'resolveFromHttp' | 'resolveFromUserToken'> = {
      resolveFromHttp: vi.fn().mockResolvedValue({ actorId: 'admin-1', actorKind: 'local_user' }),
      resolveFromUserToken: vi.fn(),
    };
    const guard = new HttpActorGuard(resolver as ActorContextResolver);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await guard.canActivate(buildContext(req));
    expect((req.user as { isSuperAdmin: boolean }).isSuperAdmin).toBe(true);
  });

  it('system_mcp actor maps to isSuperAdmin=false (system actors use the access-control system bypass)', async () => {
    const resolver: Pick<ActorContextResolver, 'resolveFromHttp' | 'resolveFromUserToken'> = {
      resolveFromHttp: vi.fn().mockResolvedValue({ actorId: 'mcp-1', actorKind: 'system_mcp' }),
      resolveFromUserToken: vi.fn(),
    };
    const guard = new HttpActorGuard(resolver as ActorContextResolver);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await guard.canActivate(buildContext(req));
    expect((req.user as { isSuperAdmin: boolean }).isSuperAdmin).toBe(false);
  });
});
