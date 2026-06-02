import { describe, expect, it, vi } from 'vitest';
import type { TokenService } from '../../../common/contracts/token.service';
import { createTokenTools } from '../token.tools';
import type { McpToolContext } from '../mcp.types';

const MCP_ACTOR = {
  sub: 'mcp-user-token-1',
  actorId: 'mcp-user-token-1',
  actorKind: 'system_mcp' as const,
  projectId: '00000000-0000-4000-8000-000000000001',
  email: '',
  isSuperAdmin: false,
  isActive: true,
};

const MCP_CONTEXT: McpToolContext = {
  actorUserId: MCP_ACTOR.actorId,
  actor: MCP_ACTOR,
};

function createRemoteTokenService(): TokenService {
  return {
    listUserTokens: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    createUserToken: vi.fn().mockResolvedValue({ token: { id: 'token-1' }, plaintext: 'ph_tok_remote' }),
    updateUserToken: vi.fn(),
    revealUserToken: vi.fn(),
    deleteUserToken: vi.fn(),
  } as unknown as TokenService;
}

describe('MCP token tools', () => {
  it('delegates token CRUD to the injected TokenService', async () => {
    const service = createRemoteTokenService();
    const createTool = createTokenTools(service).find((tool) => tool.name === 'token_create');
    if (!createTool) throw new Error('token_create tool missing');

    const result = await createTool.handler({ name: 'mcp-token' }, MCP_CONTEXT);

    expect(result).toEqual({ token: { id: 'token-1' }, plaintext: 'ph_tok_remote' });
    expect(service.createUserToken).toHaveBeenCalledWith({ name: 'mcp-token' }, MCP_ACTOR, 'mcp');
  });
});
