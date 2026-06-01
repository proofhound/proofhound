import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { getMcpActor, resolveMcpProjectContext } from '../mcp-context';
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
});
