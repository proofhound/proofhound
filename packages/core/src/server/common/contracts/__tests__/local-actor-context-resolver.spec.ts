import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalActorContextResolver } from '../local-actor-context.resolver';
import type { LocalUserTokenVerifier } from '../local-user-token.verifier';
import type { HttpRequestLike } from '../types';
import { LOCAL_ACTOR_ID } from '../../actor-context';

describe('LocalActorContextResolver', () => {
  let verifier: { verify: ReturnType<typeof vi.fn> };
  let resolver: LocalActorContextResolver;
  const originalEnvHeader = process.env.PH_TRUSTED_USER_HEADER;

  beforeEach(() => {
    verifier = { verify: vi.fn().mockResolvedValue({ actorId: 'tok-1', actorKind: 'script' }) };
    resolver = new LocalActorContextResolver(verifier as unknown as LocalUserTokenVerifier);
  });

  afterEach(() => {
    if (originalEnvHeader === undefined) delete process.env.PH_TRUSTED_USER_HEADER;
    else process.env.PH_TRUSTED_USER_HEADER = originalEnvHeader;
  });

  function buildReq(
    headers: Record<string, string | string[] | undefined>,
    extra: { ip?: string; socket?: { remoteAddress?: string } } = {},
  ): HttpRequestLike {
    return { headers, ...extra };
  }

  describe('API channel — Authorization: Bearer ph_*', () => {
    it('happy path: 解析 Bearer header + 把 ip 传给 verifier + actorKind=script', async () => {
      const actor = await resolver.resolveFromHttp(
        buildReq({ authorization: 'Bearer ph_tok_abc' }, { ip: '127.0.0.1' }),
      );
      expect(actor).toEqual({ actorId: 'tok-1', actorKind: 'script' });
      expect(verifier.verify).toHaveBeenCalledWith('ph_tok_abc', {
        clientIp: '127.0.0.1',
        actorKind: 'script',
      });
    });

    it('header 不是 Bearer 抛 invalid_authorization_header', async () => {
      await expect(
        resolver.resolveFromHttp(buildReq({ authorization: 'Basic foo' })),
      ).rejects.toThrow(/invalid_authorization_header/);
    });

    it('Bearer 后无 token 抛 invalid_authorization_header', async () => {
      await expect(resolver.resolveFromHttp(buildReq({ authorization: 'Bearer   ' }))).rejects.toThrow(
        /invalid_authorization_header/,
      );
    });

    it('verifier 抛 401 时不被包装', async () => {
      verifier.verify.mockRejectedValueOnce(new UnauthorizedException('invalid_user_token'));
      await expect(resolver.resolveFromHttp(buildReq({ authorization: 'Bearer ph_x' }))).rejects.toThrow(
        /invalid_user_token/,
      );
    });

    it('header 是数组时取第一个', async () => {
      await resolver.resolveFromHttp(
        buildReq({ authorization: ['Bearer ph_tok_first', 'Bearer ph_tok_second'] }),
      );
      expect(verifier.verify).toHaveBeenCalledWith('ph_tok_first', {
        clientIp: undefined,
        actorKind: 'script',
      });
    });

    it('fallback 到 socket.remoteAddress 作为 clientIp', async () => {
      const req = buildReq({ authorization: 'Bearer ph_tok_abc' }, { socket: { remoteAddress: '10.0.0.5' } });
      await resolver.resolveFromHttp(req);
      expect(verifier.verify).toHaveBeenCalledWith('ph_tok_abc', {
        clientIp: '10.0.0.5',
        actorKind: 'script',
      });
    });
  });

  describe('JWT rejection — OSS 不验签 JWT', () => {
    it('Bearer eyJ* (JWT shape) 抛 unsupported_credential，不调 verifier', async () => {
      const jwtToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsb2NhbCJ9.signature';
      await expect(
        resolver.resolveFromHttp(buildReq({ authorization: `Bearer ${jwtToken}` })),
      ).rejects.toThrow(/unsupported_credential/);
      expect(verifier.verify).not.toHaveBeenCalled();
    });

    it('Bearer eyJ* 但 dot 数量错误 (非 JWT 结构) 仍走 token 校验', async () => {
      // 没两个 dot 不是 JWT，OSS 把它当成普通 token（实际会被 verifier 拒，但不在 resolver 层拒）
      await resolver.resolveFromHttp(buildReq({ authorization: 'Bearer eyJhbGc.notjwt' }));
      expect(verifier.verify).toHaveBeenCalled();
    });
  });

  describe('UI channel — formation A LOCAL_ACTOR fallback', () => {
    it('无 Authorization + 无 trusted header → LOCAL_ACTOR + actorKind=local_user', async () => {
      const actor = await resolver.resolveFromHttp(buildReq({}));
      expect(actor).toEqual({ actorId: LOCAL_ACTOR_ID, actorKind: 'local_user' });
      expect(verifier.verify).not.toHaveBeenCalled();
    });

    it('空字符串 Authorization 视为缺失，走 UI fallback', async () => {
      const actor = await resolver.resolveFromHttp(buildReq({ authorization: '' }));
      expect(actor).toEqual({ actorId: LOCAL_ACTOR_ID, actorKind: 'local_user' });
    });
  });

  describe('UI channel — formation B trusted deployment header', () => {
    it('默认 X-Forwarded-User 命中 → LOCAL_ACTOR + actorKind=local_user', async () => {
      const actor = await resolver.resolveFromHttp(buildReq({ 'x-forwarded-user': 'alice@example.com' }));
      expect(actor).toEqual({ actorId: LOCAL_ACTOR_ID, actorKind: 'local_user' });
      expect(verifier.verify).not.toHaveBeenCalled();
    });

    it('PH_TRUSTED_USER_HEADER 覆盖默认 header 名', async () => {
      process.env.PH_TRUSTED_USER_HEADER = 'Cf-Access-Authenticated-User-Email';
      const actor = await resolver.resolveFromHttp(
        buildReq({ 'cf-access-authenticated-user-email': 'alice@example.com' }),
      );
      expect(actor).toEqual({ actorId: LOCAL_ACTOR_ID, actorKind: 'local_user' });
    });

    it('Authorization 与 trusted header 同时存在时优先走 API 通道', async () => {
      await resolver.resolveFromHttp(
        buildReq({ authorization: 'Bearer ph_tok_x', 'x-forwarded-user': 'alice@example.com' }),
      );
      expect(verifier.verify).toHaveBeenCalled();
    });
  });

  describe('resolveFromUserToken', () => {
    it('不传 clientIp 给 verifier，actorKind=script', async () => {
      await resolver.resolveFromUserToken('ph_tok_x');
      expect(verifier.verify).toHaveBeenCalledWith('ph_tok_x', { actorKind: 'script' });
    });
  });
});
