import { Global, Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ActorContextResolver } from '../../../common/contracts/actor-context.resolver';
import { ProjectContextResolver } from '../../../common/contracts/project-context.resolver';
import { TokenService } from '../../../common/contracts/token.service';
import { TokenModule } from '../token.module';

function createSaasContractsModule(remoteTokenService: TokenService) {
  const resolveFromHttp = vi.fn().mockResolvedValue({ actorId: 'saas-user-1', actorKind: 'local_user' });
  const resolveProject = vi.fn().mockResolvedValue(LOCAL_PROJECT_CONTEXT);

  @Global()
  @Module({
    providers: [
      { provide: TokenService, useValue: remoteTokenService },
      { provide: ActorContextResolver, useValue: { resolveFromHttp, resolveFromUserToken: vi.fn() } },
      { provide: ProjectContextResolver, useValue: { resolve: resolveProject } },
    ],
    exports: [TokenService, ActorContextResolver, ProjectContextResolver],
  })
  class SaasContractsModule {}

  return { module: SaasContractsModule, resolveFromHttp, resolveProject };
}

function createRemoteTokenService(): TokenService {
  return {
    listUserTokens: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    createUserToken: vi.fn(),
    updateUserToken: vi.fn(),
    revealUserToken: vi.fn(),
    deleteUserToken: vi.fn(),
  } as unknown as TokenService;
}

describe('TokenModule contract wiring', () => {
  it('does not bind a local TokenService provider that would shadow the contracts module', () => {
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TokenModule) ?? []) as unknown[];
    expect(providers).not.toContain(TokenService);
    expect(providers).not.toEqual(expect.arrayContaining([expect.objectContaining({ provide: TokenService })]));
  });

  it('resolves TokenController through the edition-supplied TokenService', async () => {
    const remoteTokenService = createRemoteTokenService();
    const contracts = createSaasContractsModule(remoteTokenService);
    const moduleRef = await Test.createTestingModule({
      imports: [contracts.module, TokenModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer()).get('/tokens').expect(200, { data: [], total: 0 });

    expect(remoteTokenService.listUserTokens).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'saas-user-1', actorKind: 'local_user' }),
    );
    expect(contracts.resolveFromHttp).toHaveBeenCalledTimes(1);
    expect(contracts.resolveProject).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
