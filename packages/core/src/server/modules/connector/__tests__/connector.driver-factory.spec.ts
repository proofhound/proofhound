import { getOutputDriver, probeRedisKey } from '@proofhound/connector-client';
import { vi, type Mocked } from 'vitest';
import type { CryptoService } from '../../../../shared/crypto/crypto.service';
import { ConnectorDriverFactory } from '../connector.driver-factory';

vi.mock('@proofhound/connector-client', () => ({
  getInputDriver: vi.fn(),
  getOutputDriver: vi.fn(),
  probeKafkaTopic: vi.fn().mockResolvedValue({ error: null, metadata: { exists: true } }),
  probeRedisKey: vi.fn().mockResolvedValue({ error: null, metadata: { exists: true } }),
}));

describe('ConnectorDriverFactory', () => {
  let crypto: Mocked<CryptoService>;
  let factory: ConnectorDriverFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    crypto = {
      decryptApiKey: vi.fn((value: string) => value.replace(/^encrypted:/u, '')),
    } as unknown as Mocked<CryptoService>;
    factory = new ConnectorDriverFactory(crypto);
  });

  it('probes redis with the local connector connection config', async () => {
    await factory.probe({
      configEncrypted: 'encrypted:{"password":"snapshot-secret"}',
      type: 'redis',
      direction: 'input',
      config: {
        mode: 'stream',
        key: 'events',
        connection: {
          source: 'local_config',
          host: 'redis.local.internal',
          port: 6380,
          username: 'local-user',
          defaultDbIndex: 2,
          deploymentType: 'standalone',
        },
      },
    });

    expect(probeRedisKey).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerCredentials: expect.objectContaining({
          host: 'redis.local.internal',
          port: 6380,
          username: 'local-user',
          password: 'snapshot-secret',
          db: 2,
        }),
      }),
    );
  });

  it('pushes redis output through the output driver with local connector credentials', async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getOutputDriver).mockReturnValue({ push } as never);

    const result = await factory.push({
      configEncrypted: 'encrypted:{"password":"snapshot-secret"}',
      type: 'redis',
      direction: 'output',
      config: {
        mode: 'list',
        key: 'ph:results',
        connection: {
          source: 'local_config',
          host: 'redis.local.internal',
          port: 6380,
          username: 'local-user',
          defaultDbIndex: 2,
          deploymentType: 'standalone',
        },
      },
      messages: [{ external_id: 'sample-1', result: { label: 'positive' } }],
    });

    expect(result).toEqual({ source: 'driver', pushed: 1, error: null });
    expect(getOutputDriver).toHaveBeenCalledWith('redis', 'list');
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerCredentials: expect.objectContaining({
          host: 'redis.local.internal',
          port: 6380,
          username: 'local-user',
          password: 'snapshot-secret',
          db: 2,
        }),
        connectorConfig: expect.objectContaining({ mode: 'list', key: 'ph:results' }),
        messages: [expect.objectContaining({ external_id: 'sample-1' })],
      }),
    );
  });

  it('reports kafka output driver failures without throwing', async () => {
    vi.mocked(getOutputDriver).mockReturnValue({
      push: vi.fn().mockRejectedValue(new Error('topic authorization failed')),
    } as never);

    const result = await factory.push({
      configEncrypted: 'encrypted:{"saslPassword":"secret"}',
      type: 'kafka',
      direction: 'output',
      config: {
        topic: 'results',
        partitionKey: 'external_id',
        connection: {
          source: 'local_config',
          bootstrapBrokers: ['kafka.internal:9092'],
          securityProtocol: 'SASL_SSL',
          saslMechanism: 'SCRAM-SHA-512',
          saslUsername: 'project-user',
        },
      },
      messages: [{ external_id: 'sample-1' }],
    });

    expect(result).toEqual({ source: 'driver', pushed: 0, error: 'topic authorization failed' });
  });
});
