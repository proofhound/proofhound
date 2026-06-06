import { randomBytes } from 'node:crypto';
import { encryptApiKey } from '@proofhound/crypto';
import type { DbClient } from '@proofhound/db';
import type { ProjectContext } from '@proofhound/shared';
import { LOCAL_PROJECT_ID } from '@proofhound/shared';
import { describe, expect, it, vi } from 'vitest';
import { createProbeRunner } from '../probe-runner';
import { LimiterKeyStrategy } from '../../../server/common/contracts/limiter-key.strategy';
import { createModelSecretResolver } from '../model-secret';

const testModelConnectivityMock = vi.hoisted(() => vi.fn());
vi.mock('@proofhound/llm-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, testModelConnectivity: testModelConnectivityMock };
});

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

const activeModel = {
  id: '11111111-1111-1111-1111-111111111111',
  providerType: 'openai',
  providerModelId: 'gpt-test',
  endpoint: 'https://llm.example.test/v1',
  apiKeyEncrypted: encryptApiKey('test-key', ENCRYPTION_KEY),
  isActive: true,
  rpmLimit: 60,
  tpmLimit: 1000,
  concurrencyLimit: 2,
  inputTokenPricePerMillion: '1.5',
  outputTokenPricePerMillion: '3.5',
  capabilities: { image: 'both' },
  extraBody: { top_k: 40 },
};

describe('runProbeJob — orgId 透传至限流 key 的 ProjectContext', () => {
  class SpyStrategy extends LimiterKeyStrategy {
    seen?: ProjectContext;
    buildModelKey(project: ProjectContext, modelId: string): string {
      this.seen = project;
      return `model:${modelId}`;
    }
  }

  it('forwards payload.orgId (and projectId) into buildModelKey project arg', async () => {
    testModelConnectivityMock.mockResolvedValue({
      ok: true,
      modelId: activeModel.id,
      providerType: 'openai',
      providerModelId: 'gpt-test',
      endpoint: activeModel.endpoint,
      durationMs: 1,
      checkedAt: '2026-05-21T00:00:00.000Z',
    });
    const spy = new SpyStrategy();
    const projectId = '22222222-2222-4222-8222-222222222222';
    const runProbeJob = createProbeRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: spy,
      logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
    });

    await runProbeJob({ modelId: activeModel.id, projectId, orgId: 'org-xyz' });

    expect(spy.seen?.orgId).toBe('org-xyz');
    expect(spy.seen?.projectId).toBe(projectId);
  });

  it('falls back to LOCAL_PROJECT_CONTEXT when projectId is absent (OSS default)', async () => {
    testModelConnectivityMock.mockResolvedValue({
      ok: true,
      modelId: activeModel.id,
      providerType: 'openai',
      providerModelId: 'gpt-test',
      endpoint: activeModel.endpoint,
      durationMs: 1,
      checkedAt: '2026-05-21T00:00:00.000Z',
    });
    const spy = new SpyStrategy();
    const runProbeJob = createProbeRunner({
      db: fakeDb(activeModel),
      limiter: { acquire: vi.fn(async () => undefined), release: vi.fn(async () => undefined) } as never,
      limiterKeyStrategy: spy,
      logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
    });

    await runProbeJob({ modelId: activeModel.id });

    expect(spy.seen?.projectId).toBe(LOCAL_PROJECT_ID);
    expect(spy.seen?.orgId).toBeUndefined();
  });
});

// Supports both loadModelInvocationConfig's select(...).limit() read and the probe's update(...).where() write.
function fakeDb(row: typeof activeModel | undefined): DbClient {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  } as unknown as DbClient;
}
