import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi, type Mocked } from 'vitest';
import { CryptoService } from '../../../../shared/crypto/crypto.service';
import { ConnectorDriverFactory } from '../connector.driver-factory';
import {
  ConnectorRepository,
  type ConnectorRow,
  type ConnectorRowWithJoins,
  type WebhookTokenRow,
} from '../connector.repository';
import { ConnectorService } from '../connector.service';
import { AccessControlService } from '../../../common/contracts/access-control.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';

const WORKSPACE_ID = '11111111-1111-4111-8111-000000000010';
const CONNECTOR_ID = '22222222-2222-4222-8222-000000000010';
const WEBHOOK_CONNECTOR_ID = '33333333-3333-4333-8333-000000000010';
const TOKEN_ID = '44444444-4444-4444-8444-000000000010';
const ACTOR = { sub: 'local-user', email: 'local@proofhound.dev', isSuperAdmin: true, isActive: true };

function fakeJoinRow(overrides: Partial<ConnectorRowWithJoins> = {}): ConnectorRowWithJoins {
  return {
    id: CONNECTOR_ID,
    projectId: WORKSPACE_ID,
    name: 'redis-input-stream',
    description: 'stream input',
    direction: 'input',
    type: 'redis',
    configEncrypted: null,
    config: {
      mode: 'stream',
      key: 'events:stream',
      connection: {
        source: 'local_config',
        host: 'redis.local.internal',
        port: 6379,
      },
    },
    webhookPath: null,
    ipWhitelist: null,
    healthStatus: 'unknown',
    lastProbedAt: null,
    lastProbeError: null,
    createdBy: ACTOR.sub,
    createdByDisplayName: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-10T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function fakeRow(overrides: Partial<ConnectorRow> = {}): ConnectorRow {
  return {
    id: CONNECTOR_ID,
    projectId: WORKSPACE_ID,
    name: 'redis-input-stream',
    description: null,
    direction: 'input',
    type: 'redis',
    configEncrypted: null,
    config: {
      mode: 'stream',
      key: 'events',
      connection: {
        source: 'local_config',
        host: 'redis.local.internal',
        port: 6379,
      },
    },
    webhookPath: null,
    ipWhitelist: null,
    healthStatus: 'unknown',
    lastProbedAt: null,
    lastProbeError: null,
    createdBy: ACTOR.sub,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-10T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function fakeWebhookTokenRow(overrides: Partial<WebhookTokenRow> = {}): WebhookTokenRow {
  return {
    id: TOKEN_ID,
    connectorId: WEBHOOK_CONNECTOR_ID,
    projectId: WORKSPACE_ID,
    name: 'Auto-generated webhook token',
    prefix: 'ph_wh_aaaaa',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date('2026-05-10T00:00:00Z'),
    ...overrides,
  };
}

describe('ConnectorService', () => {
  let service: ConnectorService;
  let repo: Mocked<ConnectorRepository>;
  let driverFactory: Mocked<ConnectorDriverFactory>;
  let crypto: Mocked<CryptoService>;

  beforeEach(async () => {
    repo = {
      findProjectAccess: vi.fn().mockResolvedValue({ id: WORKSPACE_ID }),
      listByProject: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      findByProjectAndName: vi.fn().mockResolvedValue(null),
      findByWebhookPath: vi.fn().mockResolvedValue(null),
      insert: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn().mockResolvedValue(undefined),
      updateProbeOutcome: vi.fn().mockResolvedValue(undefined),
      countReferences: vi
        .fn()
        .mockResolvedValue(new Map([[CONNECTOR_ID, { canaryReleases: 0, productionReleases: 0 }]])),
      listReferenceDetails: vi.fn().mockResolvedValue([]),
      countByProject: vi.fn().mockResolvedValue(0),
      findManyByIds: vi.fn().mockResolvedValue([]),
      listWebhookTokensForConnector: vi.fn().mockResolvedValue([]),
      findWebhookTokenById: vi.fn(),
      findWebhookTokenWithEncryptedById: vi.fn(),
      insertWebhookToken: vi.fn().mockResolvedValue({ id: TOKEN_ID }),
      revokeWebhookToken: vi.fn().mockResolvedValue(true),
      countActiveWebhookTokens: vi.fn().mockResolvedValue(1),
      countActiveWebhookTokensByConnectorIds: vi.fn().mockResolvedValue(new Map()),
    } as unknown as Mocked<ConnectorRepository>;

    driverFactory = {
      peek: vi.fn().mockResolvedValue({ source: 'driver', messages: [], error: null }),
      probe: vi.fn().mockResolvedValue({ source: 'driver', error: null }),
    } as unknown as Mocked<ConnectorDriverFactory>;
    crypto = {
      encryptApiKey: vi.fn((value: string) => `encrypted:${value}`),
      decryptApiKey: vi.fn((value: string) => value.replace(/^encrypted:/u, '')),
    } as unknown as Mocked<CryptoService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorService,
        { provide: ConnectorRepository, useValue: repo },
        { provide: ConnectorDriverFactory, useValue: driverFactory },
        { provide: CryptoService, useValue: crypto },
        { provide: AccessControlService, useClass: LocalAccessControlService },
      ],
    }).compile();
    service = moduleRef.get(ConnectorService);
  });

  it('rejects users without local workspace access', async () => {
    repo.findProjectAccess.mockResolvedValueOnce(null);
    await expect(service.list(WORKSPACE_ID, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates redis connectors from local connection config only', async () => {
    repo.insert.mockResolvedValue(fakeRow());
    repo.findById.mockResolvedValue(fakeJoinRow());

    await service.create(
      WORKSPACE_ID,
      {
        type: 'redis',
        direction: 'input',
        name: 'direct-redis',
        credentials: { password: 'direct-secret' },
        config: {
          mode: 'stream',
          key: 'events',
          connection: {
            source: 'local_config',
            host: 'redis.local.internal',
            port: 6380,
            deploymentType: 'standalone',
            defaultDbIndex: 0,
          },
        },
      },
      ACTOR,
    );

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        configEncrypted: 'encrypted:{"password":"direct-secret"}',
        config: expect.objectContaining({
          connection: expect.objectContaining({
            source: 'local_config',
            host: 'redis.local.internal',
            port: 6380,
          }),
        }),
      }),
    );
    // Non-webhook connectors must not trigger automatic webhook token generation
    expect(repo.insertWebhookToken).not.toHaveBeenCalled();
  });

  it('requires local connection config for queue connectors', async () => {
    await expect(
      service.create(
        WORKSPACE_ID,
        {
          type: 'redis',
          direction: 'input',
          name: 'missing-connection',
          config: { mode: 'stream', key: 'events' },
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('auto-generates a webhook token when creating a webhook input connector and returns the plaintext once', async () => {
    repo.insert.mockResolvedValue(fakeRow({ id: WEBHOOK_CONNECTOR_ID, type: 'webhook', direction: 'input' }));
    repo.findById.mockResolvedValue(
      fakeJoinRow({ id: WEBHOOK_CONNECTOR_ID, type: 'webhook', direction: 'input', webhookPath: 'p' }),
    );
    repo.listWebhookTokensForConnector.mockResolvedValue([fakeWebhookTokenRow()]);
    repo.insertWebhookToken.mockResolvedValue({ id: TOKEN_ID });

    const response = await service.create(
      WORKSPACE_ID,
      {
        type: 'webhook',
        direction: 'input',
        name: 'wh-in',
        config: { webhookMode: 'sync' },
      },
      ACTOR,
    );

    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ webhookPath: expect.any(String) }));
    expect(repo.insertWebhookToken).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: WEBHOOK_CONNECTOR_ID,
        projectId: WORKSPACE_ID,
        name: 'Auto-generated webhook token',
        prefix: expect.any(String),
        tokenHash: expect.any(String),
        tokenEncrypted: expect.stringMatching(/^encrypted:/u),
        createdBy: ACTOR.sub,
      }),
    );
    expect(response.initialWebhookToken).toMatchObject({
      id: TOKEN_ID,
      name: 'Auto-generated webhook token',
      plaintext: expect.stringMatching(/^ph_wh_/u),
      expiresAt: null,
    });
    expect(response.webhookTokens).toHaveLength(1);
  });

  it('rejects duplicate connector names', async () => {
    repo.findByProjectAndName.mockResolvedValueOnce(fakeRow());

    await expect(
      service.create(
        WORKSPACE_ID,
        {
          type: 'redis',
          direction: 'input',
          name: 'redis-input-stream',
          config: {
            mode: 'stream',
            key: 'events',
            connection: { source: 'local_config', host: 'redis.local.internal', port: 6379 },
          },
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks delete when referenced unless force=true', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow());
    repo.countReferences.mockResolvedValueOnce(
      new Map([[CONNECTOR_ID, { canaryReleases: 1, productionReleases: 0 }]]),
    );

    await expect(service.delete(WORKSPACE_ID, CONNECTOR_ID, {}, ACTOR)).rejects.toBeInstanceOf(ConflictException);

    repo.countReferences.mockResolvedValueOnce(
      new Map([[CONNECTOR_ID, { canaryReleases: 1, productionReleases: 0 }]]),
    );
    await service.delete(WORKSPACE_ID, CONNECTOR_ID, { force: true, reason: 'cleanup' }, ACTOR);
    expect(repo.softDelete).toHaveBeenCalledWith(WORKSPACE_ID, CONNECTOR_ID);
  });

  it('forwards peek to the driver factory and stores inferred schema metadata', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow());
    driverFactory.peek.mockResolvedValueOnce({
      source: 'driver',
      messages: [
        {
          id: 'm1',
          receivedAt: '2026-05-10T00:00:00.000Z',
          payload: { hi: 1, nested: { ok: true } },
        },
      ],
      error: null,
    });

    const result = await service.peek(WORKSPACE_ID, CONNECTOR_ID, { limit: 5 }, ACTOR);

    expect(result.source).toBe('driver');
    expect(result.messages).toHaveLength(1);
    expect(repo.update).toHaveBeenCalledWith(
      WORKSPACE_ID,
      CONNECTOR_ID,
      expect.objectContaining({
        config: expect.objectContaining({
          lastPeekPayloadSchema: result.payloadSchema,
          lastPeekMessage: result.messages[0],
          lastPeekedAt: expect.any(String),
          lastPeekMessageCount: 1,
        }),
        healthStatus: 'healthy',
      }),
    );
  });

  it('records probe status from the driver factory', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow());
    driverFactory.probe.mockResolvedValueOnce({ source: 'driver', error: 'kafka topic not found: risk-decisions' });

    const result = await service.probe(WORKSPACE_ID, CONNECTOR_ID, ACTOR);

    expect(result.status).toBe('failed');
    expect(repo.updateProbeOutcome).toHaveBeenCalledWith(
      WORKSPACE_ID,
      CONNECTOR_ID,
      expect.any(Date),
      'kafka topic not found: risk-decisions',
    );
  });

  it('returns partial bulk delete success when some connectors are referenced', async () => {
    const idA = '55555555-5555-4555-8555-000000000010';
    const idB = '66666666-6666-4666-8666-000000000010';
    repo.findManyByIds.mockResolvedValue([fakeRow({ id: idA }), fakeRow({ id: idB })]);
    repo.countReferences.mockResolvedValue(
      new Map([
        [idA, { canaryReleases: 0, productionReleases: 0 }],
        [idB, { canaryReleases: 1, productionReleases: 0 }],
      ]),
    );

    const result = await service.bulkDelete(WORKSPACE_ID, { ids: [idA, idB] }, ACTOR);

    expect(result.deletedIds).toEqual([idA]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ id: idB, reason: 'connector_referenced' });
  });

  it('preserves the saved connection config when queue config is edited', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow());

    await service.update(WORKSPACE_ID, CONNECTOR_ID, { config: { mode: 'stream', key: 'events:next' } }, ACTOR);

    expect(repo.update).toHaveBeenCalledWith(
      WORKSPACE_ID,
      CONNECTOR_ID,
      expect.objectContaining({
        config: expect.objectContaining({
          key: 'events:next',
          connection: expect.objectContaining({ host: 'redis.local.internal', port: 6379 }),
        }),
      }),
    );
  });

  it('updates the saved connection config and encrypted credential when edited', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow({ configEncrypted: 'encrypted:{"password":"old-secret"}' }));

    await service.update(
      WORKSPACE_ID,
      CONNECTOR_ID,
      {
        credentials: { password: 'new-secret' },
        config: {
          mode: 'stream',
          key: 'events',
          connection: {
            source: 'local_config',
            host: 'redis.local.next',
            port: 6380,
            username: 'default',
            defaultDbIndex: 2,
            deploymentType: 'standalone',
          },
        },
      },
      ACTOR,
    );

    expect(repo.update).toHaveBeenCalledWith(
      WORKSPACE_ID,
      CONNECTOR_ID,
      expect.objectContaining({
        configEncrypted: 'encrypted:{"password":"new-secret"}',
        config: expect.objectContaining({
          connection: expect.objectContaining({
            source: 'local_config',
            host: 'redis.local.next',
            port: 6380,
          }),
        }),
      }),
    );
  });

  it('lists webhook tokens for a webhook input connector', async () => {
    repo.findById.mockResolvedValue(
      fakeJoinRow({ id: WEBHOOK_CONNECTOR_ID, type: 'webhook', direction: 'input', webhookPath: 'p' }),
    );
    repo.listWebhookTokensForConnector.mockResolvedValue([
      fakeWebhookTokenRow({ id: TOKEN_ID }),
      fakeWebhookTokenRow({ id: '44444444-4444-4444-8444-000000000020', name: 'rotated' }),
    ]);

    const response = await service.listWebhookTokens(WORKSPACE_ID, WEBHOOK_CONNECTOR_ID, ACTOR);

    expect(response.total).toBe(2);
    expect(response.data[0]).toMatchObject({ id: TOKEN_ID, name: 'Auto-generated webhook token' });
  });

  it('creates a webhook token and returns the plaintext once', async () => {
    repo.findById.mockResolvedValue(
      fakeJoinRow({ id: WEBHOOK_CONNECTOR_ID, type: 'webhook', direction: 'input', webhookPath: 'p' }),
    );
    repo.insertWebhookToken.mockResolvedValue({ id: TOKEN_ID });

    const response = await service.createWebhookToken(
      WORKSPACE_ID,
      WEBHOOK_CONNECTOR_ID,
      { name: 'rotated' },
      ACTOR,
    );

    expect(response).toMatchObject({
      id: TOKEN_ID,
      name: 'rotated',
      plaintext: expect.stringMatching(/^ph_wh_/u),
      expiresAt: null,
    });
    expect(repo.insertWebhookToken).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: WEBHOOK_CONNECTOR_ID, projectId: WORKSPACE_ID, name: 'rotated' }),
    );
  });

  it('rejects createWebhookToken on non-webhook connector', async () => {
    repo.findById.mockResolvedValue(fakeJoinRow({ type: 'redis', direction: 'input' }));

    await expect(
      service.createWebhookToken(WORKSPACE_ID, CONNECTOR_ID, {}, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revokes a webhook token by id', async () => {
    repo.findById.mockResolvedValue(
      fakeJoinRow({ id: WEBHOOK_CONNECTOR_ID, type: 'webhook', direction: 'input', webhookPath: 'p' }),
    );
    repo.findWebhookTokenById.mockResolvedValue(fakeWebhookTokenRow({ id: TOKEN_ID }));
    repo.revokeWebhookToken.mockResolvedValue(true);
    repo.countActiveWebhookTokens.mockResolvedValue(0);

    await service.revokeWebhookToken(WORKSPACE_ID, WEBHOOK_CONNECTOR_ID, TOKEN_ID, ACTOR);

    expect(repo.revokeWebhookToken).toHaveBeenCalledWith(WEBHOOK_CONNECTOR_ID, TOKEN_ID);
  });

  it('throws when revoking an unknown webhook token', async () => {
    repo.findById.mockResolvedValue(
      fakeJoinRow({ id: WEBHOOK_CONNECTOR_ID, type: 'webhook', direction: 'input', webhookPath: 'p' }),
    );
    repo.findWebhookTokenById.mockResolvedValue(null);

    await expect(
      service.revokeWebhookToken(WORKSPACE_ID, WEBHOOK_CONNECTOR_ID, TOKEN_ID, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reveals webhook token plaintext from token_encrypted', async () => {
    repo.findById.mockResolvedValue(
      fakeJoinRow({ id: WEBHOOK_CONNECTOR_ID, type: 'webhook', direction: 'input', webhookPath: 'p' }),
    );
    repo.findWebhookTokenWithEncryptedById.mockResolvedValue({
      ...fakeWebhookTokenRow({ id: TOKEN_ID }),
      tokenEncrypted: 'encrypted:ph_wh_plaintext_value',
    });

    const response = await service.revealWebhookToken(WORKSPACE_ID, WEBHOOK_CONNECTOR_ID, TOKEN_ID, ACTOR);

    expect(response).toEqual({ tokenId: TOKEN_ID, plaintext: 'ph_wh_plaintext_value', available: true });
    expect(crypto.decryptApiKey).toHaveBeenCalledWith('encrypted:ph_wh_plaintext_value');
  });

  it('returns available=false when token_encrypted missing', async () => {
    repo.findById.mockResolvedValue(
      fakeJoinRow({ id: WEBHOOK_CONNECTOR_ID, type: 'webhook', direction: 'input', webhookPath: 'p' }),
    );
    repo.findWebhookTokenWithEncryptedById.mockResolvedValue({
      ...fakeWebhookTokenRow({ id: TOKEN_ID }),
      tokenEncrypted: null,
    });

    const response = await service.revealWebhookToken(WORKSPACE_ID, WEBHOOK_CONNECTOR_ID, TOKEN_ID, ACTOR);

    expect(response).toEqual({ tokenId: TOKEN_ID, plaintext: null, available: false });
  });

  it('throws when revealing an unknown webhook token', async () => {
    repo.findById.mockResolvedValue(
      fakeJoinRow({ id: WEBHOOK_CONNECTOR_ID, type: 'webhook', direction: 'input', webhookPath: 'p' }),
    );
    repo.findWebhookTokenWithEncryptedById.mockResolvedValue(null);

    await expect(
      service.revealWebhookToken(WORKSPACE_ID, WEBHOOK_CONNECTOR_ID, TOKEN_ID, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('silently ignores deprecated update.tokenId for backward compatibility', async () => {
    repo.findById.mockResolvedValue(
      fakeJoinRow({ id: WEBHOOK_CONNECTOR_ID, type: 'webhook', direction: 'input', webhookPath: 'p' }),
    );

    await service.update(WORKSPACE_ID, WEBHOOK_CONNECTOR_ID, { tokenId: TOKEN_ID }, ACTOR);

    // patch must not contain any webhookTokenId (column has been dropped); update should still succeed
    expect(repo.update).toHaveBeenCalledWith(WORKSPACE_ID, WEBHOOK_CONNECTOR_ID, expect.objectContaining({}));
  });
});
