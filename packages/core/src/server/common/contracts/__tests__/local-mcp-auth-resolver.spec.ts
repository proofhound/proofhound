import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMcpAuthResolver } from '../local-mcp-auth.resolver';
import type { LocalUserTokenVerifier } from '../local-user-token.verifier';

describe('LocalMcpAuthResolver', () => {
  let verifier: { verify: ReturnType<typeof vi.fn> };
  let resolver: LocalMcpAuthResolver;

  beforeEach(() => {
    verifier = { verify: vi.fn().mockResolvedValue({ actorId: 'tok-m', actorKind: 'system_mcp' }) };
    resolver = new LocalMcpAuthResolver(verifier as unknown as LocalUserTokenVerifier);
  });

  it('从 metadata.authInfo.token 提取并校验', async () => {
    const actor = await resolver.resolveFromMcp({ authInfo: { token: 'ph_tok_a' } });
    expect(actor).toEqual({ actorId: 'tok-m', actorKind: 'system_mcp' });
    expect(verifier.verify).toHaveBeenCalledWith('ph_tok_a', { actorKind: 'system_mcp' });
  });

  it('从 metadata.headers Authorization Bearer 提取', async () => {
    await resolver.resolveFromMcp({ headers: { authorization: 'Bearer ph_tok_b' } });
    expect(verifier.verify).toHaveBeenCalledWith('ph_tok_b', { actorKind: 'system_mcp' });
  });

  it('从 metadata.meta.token 提取', async () => {
    await resolver.resolveFromMcp({ meta: { token: 'ph_tok_c' } });
    expect(verifier.verify).toHaveBeenCalledWith('ph_tok_c', { actorKind: 'system_mcp' });
  });

  it('metadata 完全没 token 抛 missing_user_token', async () => {
    await expect(resolver.resolveFromMcp({})).rejects.toThrow(/missing_user_token/);
  });

  it('resolveFromUserToken 直接走 verifier 不传 IP，actorKind=system_mcp', async () => {
    await resolver.resolveFromUserToken('ph_tok_d');
    expect(verifier.verify).toHaveBeenCalledWith('ph_tok_d', { actorKind: 'system_mcp' });
  });
});
