import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import {
  CryptoModule,
  CryptoService,
  DATABASE_CLIENT,
  DatabaseModule,
  REDIS_CLIENT,
  REDIS_LIMITER,
  RedisModule,
  RedisMutexService,
} from '@proofhound/core/infra';
import {
  LocalConnectorContextResolver,
  LocalQuotaPolicyHook,
  LocalTokenService,
  LocalUserTokenVerifier,
  QuotaPolicyHook,
  TokenRepository,
  TokenService,
  WebhookRepository,
} from '@proofhound/core/contracts';

describe('@proofhound/core public exports', () => {
  it('declares the stable infra subpath in package exports', () => {
    expect(packageJson.exports['./infra']).toBe('./src/infra/index.ts');
    expect(packageJson.exports['./contracts']).toBe('./src/server/common/contracts/index.ts');
  });

  it('exports shared infra modules through @proofhound/core/infra', () => {
    expect(DatabaseModule).toBeDefined();
    expect(DATABASE_CLIENT).toBeDefined();
    expect(CryptoModule).toBeDefined();
    expect(CryptoService).toBeDefined();
    expect(RedisModule).toBeDefined();
    expect(REDIS_CLIENT).toBeDefined();
    expect(REDIS_LIMITER).toBeDefined();
    expect(RedisMutexService).toBeDefined();
  });

  it('exports local contract building blocks through @proofhound/core/contracts', () => {
    expect(TokenService).toBeDefined();
    expect(LocalTokenService).toBeDefined();
    expect(LocalUserTokenVerifier).toBeDefined();
    expect(LocalConnectorContextResolver).toBeDefined();
    expect(QuotaPolicyHook).toBeDefined();
    expect(LocalQuotaPolicyHook).toBeDefined();
    expect(TokenRepository).toBeDefined();
    expect(WebhookRepository).toBeDefined();
  });
});
