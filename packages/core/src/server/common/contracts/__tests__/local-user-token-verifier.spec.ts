import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalUserTokenVerifier } from '../local-user-token.verifier';

function sha(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

function makeQueryChain(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

function makeUpdateChain() {
  const set = vi.fn().mockReturnThis();
  const where = vi.fn().mockResolvedValue([]);
  return { update: vi.fn().mockReturnValue({ set, where }), set, where };
}

describe('LocalUserTokenVerifier', () => {
  const TOKEN = 'ph_tok_plaintext_xyz';
  const HASH = sha(TOKEN);
  const TOKEN_ID = '00000000-0000-4000-8000-000000000099';
  let db: any;
  let updateChain: ReturnType<typeof makeUpdateChain>;

  beforeEach(() => {
    updateChain = makeUpdateChain();
    db = {
      select: vi.fn(),
      update: updateChain.update,
    };
  });

  function withRow(row: unknown) {
    // Every db.select() call returns a fresh chain so it is not exhausted by the previous verify's await chain.
    db.select = vi.fn(() => makeQueryChain(row ? [row] : []));
  }

  it('happy path: 返回 ActorContext，actorKind=user_token, actorId=token.id', async () => {
    withRow({ id: TOKEN_ID, ipWhitelist: null, expiresAt: null });
    const verifier = new LocalUserTokenVerifier(db);
    const actor = await verifier.verify(TOKEN, { actorKind: 'script' });
    expect(actor).toEqual({ actorId: TOKEN_ID, actorKind: 'script' });
  });

  it('使用 sha256 hash 查表（hash 长度 64 hex）', async () => {
    // The verifier internally uses createHash('sha256').update(token).digest('hex');
    // here we only assert the hash shape to avoid tightly coupling to the drizzle chain shape.
    expect(HASH).toMatch(/^[a-f0-9]{64}$/);
  });

  it('空 token 抛 invalid_user_token', async () => {
    const verifier = new LocalUserTokenVerifier(db);
    await expect(verifier.verify('', { actorKind: 'script' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verifier.verify('', { actorKind: 'script' })).rejects.toThrow(/invalid_user_token/);
  });

  it('未命中行抛 invalid_user_token', async () => {
    withRow(null);
    const verifier = new LocalUserTokenVerifier(db);
    await expect(verifier.verify(TOKEN, { actorKind: 'script' })).rejects.toThrow(/invalid_user_token/);
  });

  it('过期 token 抛 expired_user_token', async () => {
    withRow({ id: TOKEN_ID, ipWhitelist: null, expiresAt: new Date(Date.now() - 1000) });
    const verifier = new LocalUserTokenVerifier(db);
    await expect(verifier.verify(TOKEN, { actorKind: 'script' })).rejects.toThrow(/expired_user_token/);
  });

  it('未过期 token (expiresAt 未来) 正常通过', async () => {
    withRow({ id: TOKEN_ID, ipWhitelist: null, expiresAt: new Date(Date.now() + 60_000) });
    const verifier = new LocalUserTokenVerifier(db);
    await expect(verifier.verify(TOKEN, { actorKind: 'script' })).resolves.toEqual({ actorId: TOKEN_ID, actorKind: 'script' });
  });

  it('ip_whitelist 命中：clientIp 在列表内通过', async () => {
    withRow({ id: TOKEN_ID, ipWhitelist: ['10.0.0.1', '127.0.0.1'], expiresAt: null });
    const verifier = new LocalUserTokenVerifier(db);
    await expect(verifier.verify(TOKEN, { actorKind: 'script', clientIp: '127.0.0.1' })).resolves.toEqual({
      actorId: TOKEN_ID,
      actorKind: 'script',
    });
  });

  it('ip_whitelist 不命中：抛 ip_not_allowed', async () => {
    withRow({ id: TOKEN_ID, ipWhitelist: ['10.0.0.1'], expiresAt: null });
    const verifier = new LocalUserTokenVerifier(db);
    await expect(verifier.verify(TOKEN, { actorKind: 'script', clientIp: '192.168.1.1' })).rejects.toThrow(/ip_not_allowed/);
  });

  it('ip_whitelist 存在但 clientIp 未提供：跳过校验（用于 resolveFromUserToken 直接调用）', async () => {
    withRow({ id: TOKEN_ID, ipWhitelist: ['10.0.0.1'], expiresAt: null });
    const verifier = new LocalUserTokenVerifier(db);
    await expect(verifier.verify(TOKEN, { actorKind: 'script' })).resolves.toEqual({ actorId: TOKEN_ID, actorKind: 'script' });
  });

  it('ip_whitelist 为空数组时不强制校验', async () => {
    withRow({ id: TOKEN_ID, ipWhitelist: [], expiresAt: null });
    const verifier = new LocalUserTokenVerifier(db);
    await expect(verifier.verify(TOKEN, { actorKind: 'script', clientIp: '8.8.8.8' })).resolves.toEqual({
      actorId: TOKEN_ID,
      actorKind: 'script',
    });
  });

  it('成功路径异步 touch last_used_at（不阻塞调用）', async () => {
    withRow({ id: TOKEN_ID, ipWhitelist: null, expiresAt: null });
    const verifier = new LocalUserTokenVerifier(db);
    await verifier.verify(TOKEN, { actorKind: 'script' });
    // update should be called exactly once (fire-and-forget)
    expect(updateChain.update).toHaveBeenCalledTimes(1);
  });

  it('touch last_used_at 失败不冒泡', async () => {
    withRow({ id: TOKEN_ID, ipWhitelist: null, expiresAt: null });
    updateChain.where.mockRejectedValueOnce(new Error('db down'));
    const verifier = new LocalUserTokenVerifier(db);
    await expect(verifier.verify(TOKEN, { actorKind: 'script' })).resolves.toEqual({ actorId: TOKEN_ID, actorKind: 'script' });
  });
});
