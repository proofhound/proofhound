// driver-factory: decrypt the connector's local connection config into BrokerCredentials, then pick the matching input driver
// See docs/specs/26-connectors.md §9 for the sampling (peek) implementation details
import { Injectable } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import {
  getOutputDriver,
  getInputDriver,
  probeKafkaTopic,
  probeRedisKey,
  type ConsumeMessage,
  type InputDriver,
  type OutputDriver,
  type KafkaBrokerCredentials,
  type PeekResult,
  type ProbeResult,
  type RedisBrokerCredentials,
} from '@proofhound/connector-client';
import type {
  ConnectorConfigShape,
  ConnectorDirection,
  ConnectorType,
  KafkaConnectionConfig,
  KafkaInputConfig,
  KafkaOutputConfig,
  PeekConnectorMessageDto,
  RedisConnectionConfig,
  RedisInputConfig,
  RedisOutputConfig,
} from '@proofhound/shared';
import { CryptoService } from '../../../shared/crypto/crypto.service';

interface EncryptedBrokerConfig {
  password?: string;
  saslPassword?: string;
  bootstrapBrokers?: string[];
  securityProtocol?: 'PLAINTEXT' | 'SSL' | 'SASL_PLAINTEXT' | 'SASL_SSL';
  saslMechanism?: 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512';
  saslUsername?: string | null;
}

export interface DriverFactoryPeekResult {
  source: 'driver' | 'unavailable';
  messages: PeekConnectorMessageDto[];
  error: string | null;
}

export interface DriverFactoryProbeResult {
  source: 'driver' | 'unavailable';
  error: string | null;
  metadata?: Record<string, unknown>;
}

export interface DriverFactoryConsumeResult {
  source: 'driver' | 'unavailable';
  error: string | null;
}

export interface DriverFactoryPushResult {
  source: 'driver' | 'unavailable';
  error: string | null;
  pushed: number;
}

@Injectable()
export class ConnectorDriverFactory {
  private readonly logger = createLogger('connector.driver-factory', { service: 'server' });

  constructor(private readonly crypto: CryptoService) {}

  async peek(args: {
    configEncrypted?: unknown;
    type: ConnectorType;
    direction: ConnectorDirection;
    config: ConnectorConfigShape;
    limit: number;
  }): Promise<DriverFactoryPeekResult> {
    if (args.direction !== 'input') {
      return { source: 'unavailable', messages: [], error: 'peek not supported for output connectors' };
    }
    if (args.type === 'webhook') {
      // webhook input peek is degraded in this cycle: driver does not participate; the Service layer should have intercepted before reaching here
      return {
        source: 'unavailable',
        messages: [],
        error: 'webhook peek is not implemented; use the business endpoint to send a test request',
      };
    }
    if (args.type === 'redis') {
      const driver = getInputDriver('redis', (args.config as RedisInputConfig).mode);
      if (!driver) {
        return { source: 'unavailable', messages: [], error: 'redis driver not available' };
      }
      const credentials = await this.resolveRedisCredentials(args);
      if (!credentials)
        return { source: 'unavailable', messages: [], error: 'redis connector connection is not configured' };
      const result = await (driver as InputDriver<RedisBrokerCredentials, RedisInputConfig>).peek({
        brokerCredentials: credentials,
        connectorConfig: args.config as RedisInputConfig,
        limit: args.limit,
      });
      return this.toDriverResult(result);
    }

    if (args.type === 'kafka') {
      const driver = getInputDriver('kafka');
      if (!driver) {
        return { source: 'unavailable', messages: [], error: 'kafka driver not available' };
      }
      const credentials = await this.resolveKafkaCredentials(args);
      if (!credentials)
        return { source: 'unavailable', messages: [], error: 'kafka connector connection is not configured' };
      if (credentials.bootstrapBrokers.length === 0) {
        return {
          source: 'unavailable',
          messages: [],
          error: 'kafka connector connection.bootstrapBrokers is required',
        };
      }
      const result = await (driver as InputDriver<KafkaBrokerCredentials, KafkaInputConfig>).peek({
        brokerCredentials: credentials,
        connectorConfig: args.config as KafkaInputConfig,
        limit: args.limit,
      });
      return this.toDriverResult(result);
    }

    return { source: 'unavailable', messages: [], error: `unsupported connector type: ${args.type as string}` };
  }

  async probe(args: {
    configEncrypted?: unknown;
    type: ConnectorType;
    direction: ConnectorDirection;
    config: ConnectorConfigShape;
  }): Promise<DriverFactoryProbeResult> {
    if (args.type === 'webhook') {
      return { source: 'unavailable', error: null, metadata: { mode: 'webhook' } };
    }
    if (args.type === 'redis') {
      const credentials = await this.resolveRedisCredentials(args);
      if (!credentials) return { source: 'unavailable', error: 'redis connector connection is not configured' };
      const result = await probeRedisKey({
        brokerCredentials: credentials,
        connectorConfig: args.config as RedisInputConfig,
      });
      return this.toProbeResult(result);
    }

    if (args.type === 'kafka') {
      const credentials = await this.resolveKafkaCredentials(args);
      if (!credentials) return { source: 'unavailable', error: 'kafka connector connection is not configured' };
      if (credentials.bootstrapBrokers.length === 0) {
        return {
          source: 'unavailable',
          error: 'kafka connector connection.bootstrapBrokers is required',
        };
      }
      const result = await probeKafkaTopic({
        brokerCredentials: credentials,
        connectorConfig: args.config as KafkaInputConfig,
      });
      return this.toProbeResult(result);
    }

    return { source: 'unavailable', error: `unsupported connector type: ${args.type as string}` };
  }

  async consume(args: {
    configEncrypted?: unknown;
    type: ConnectorType;
    direction: ConnectorDirection;
    config: ConnectorConfigShape;
    batchSize?: number;
    timeoutMs?: number;
    consumerName?: string;
    signal?: AbortSignal;
    onMessage(message: ConsumeMessage): Promise<void>;
  }): Promise<DriverFactoryConsumeResult> {
    if (args.direction !== 'input') {
      return { source: 'unavailable', error: 'consume not supported for output connectors' };
    }
    if (args.type === 'webhook') {
      return { source: 'unavailable', error: 'webhook input is consumed by the HTTP webhook channel' };
    }
    if (args.type === 'redis') {
      const driver = getInputDriver('redis', (args.config as RedisInputConfig).mode);
      const consume = driver?.consume?.bind(driver);
      if (!consume) return { source: 'unavailable', error: 'redis consume driver not available' };
      const credentials = await this.resolveRedisCredentials(args);
      if (!credentials) return { source: 'unavailable', error: 'redis connector connection is not configured' };
      const consumeRedis = consume as NonNullable<InputDriver<RedisBrokerCredentials, RedisInputConfig>['consume']>;
      const result = await consumeRedis({
        brokerCredentials: credentials,
        connectorConfig: args.config as RedisInputConfig,
        batchSize: args.batchSize,
        timeoutMs: args.timeoutMs,
        consumerName: args.consumerName,
        signal: args.signal,
        onMessage: args.onMessage,
      });
      return { source: 'driver', error: result.error };
    }

    if (args.type === 'kafka') {
      const driver = getInputDriver('kafka');
      const consume = driver?.consume?.bind(driver);
      if (!consume) return { source: 'unavailable', error: 'kafka consume driver not available' };
      const credentials = await this.resolveKafkaCredentials(args);
      if (!credentials) return { source: 'unavailable', error: 'kafka connector connection is not configured' };
      if (credentials.bootstrapBrokers.length === 0) {
        return {
          source: 'unavailable',
          error: 'kafka connector connection.bootstrapBrokers is required',
        };
      }
      const consumeKafka = consume as NonNullable<InputDriver<KafkaBrokerCredentials, KafkaInputConfig>['consume']>;
      const result = await consumeKafka({
        brokerCredentials: credentials,
        connectorConfig: args.config as KafkaInputConfig,
        batchSize: args.batchSize,
        timeoutMs: args.timeoutMs,
        consumerName: args.consumerName,
        signal: args.signal,
        onMessage: args.onMessage,
      });
      return { source: 'driver', error: result.error };
    }

    return { source: 'unavailable', error: `unsupported connector type: ${args.type as string}` };
  }

  async push(args: {
    configEncrypted?: unknown;
    type: ConnectorType;
    direction: ConnectorDirection;
    config: ConnectorConfigShape;
    messages: unknown[];
    timeoutMs?: number;
  }): Promise<DriverFactoryPushResult> {
    if (args.direction !== 'output') {
      return { source: 'unavailable', pushed: 0, error: 'push not supported for input connectors' };
    }
    if (args.messages.length === 0) {
      return { source: 'driver', pushed: 0, error: null };
    }
    if (args.type === 'webhook') {
      return { source: 'unavailable', pushed: 0, error: 'webhook output driver is not implemented' };
    }
    if (args.type === 'redis') {
      const driver = getOutputDriver('redis', (args.config as RedisOutputConfig).mode);
      const push = driver?.push?.bind(driver);
      if (!push) return { source: 'unavailable', pushed: 0, error: 'redis output driver not available' };
      const credentials = await this.resolveRedisCredentials(args);
      if (!credentials)
        return { source: 'unavailable', pushed: 0, error: 'redis connector connection is not configured' };
      try {
        const pushRedis = push as NonNullable<OutputDriver<RedisBrokerCredentials, RedisOutputConfig>['push']>;
        await pushRedis({
          brokerCredentials: credentials,
          connectorConfig: args.config as RedisOutputConfig,
          messages: args.messages,
          timeoutMs: args.timeoutMs,
        });
        return { source: 'driver', pushed: args.messages.length, error: null };
      } catch (error) {
        return {
          source: 'driver',
          pushed: 0,
          error: error instanceof Error ? error.message : 'unknown redis output error',
        };
      }
    }

    if (args.type === 'kafka') {
      const driver = getOutputDriver('kafka');
      const push = driver?.push?.bind(driver);
      if (!push) return { source: 'unavailable', pushed: 0, error: 'kafka output driver not available' };
      const credentials = await this.resolveKafkaCredentials(args);
      if (!credentials)
        return { source: 'unavailable', pushed: 0, error: 'kafka connector connection is not configured' };
      if (credentials.bootstrapBrokers.length === 0) {
        return {
          source: 'unavailable',
          pushed: 0,
          error: 'kafka connector connection.bootstrapBrokers is required',
        };
      }
      try {
        const pushKafka = push as NonNullable<OutputDriver<KafkaBrokerCredentials, KafkaOutputConfig>['push']>;
        await pushKafka({
          brokerCredentials: credentials,
          connectorConfig: args.config as KafkaOutputConfig,
          messages: args.messages,
          timeoutMs: args.timeoutMs,
        });
        return { source: 'driver', pushed: args.messages.length, error: null };
      } catch (error) {
        return {
          source: 'driver',
          pushed: 0,
          error: error instanceof Error ? error.message : 'unknown kafka output error',
        };
      }
    }

    return { source: 'unavailable', pushed: 0, error: `unsupported connector type: ${args.type as string}` };
  }

  private async resolveRedisCredentials(args: {
    configEncrypted?: unknown;
    config: ConnectorConfigShape;
  }): Promise<RedisBrokerCredentials | null> {
    const decrypted = this.decryptBrokerConfig(args.configEncrypted);
    const connection = this.getConnection(args.config);
    if (connection) {
      const redisConnection = connection as Partial<RedisConnectionConfig>;
      return {
        host: redisConnection.host ?? '',
        port: redisConnection.port ?? 6379,
        username: redisConnection.username ?? null,
        password: decrypted.password ?? null,
        db: redisConnection.defaultDbIndex ?? null,
        deploymentType: redisConnection.deploymentType ?? null,
      };
    }

    return null;
  }

  private async resolveKafkaCredentials(args: {
    configEncrypted?: unknown;
    config: ConnectorConfigShape;
  }): Promise<KafkaBrokerCredentials | null> {
    const decrypted = this.decryptBrokerConfig(args.configEncrypted);
    const connection = this.getConnection(args.config);
    if (connection) {
      const kafkaConnection = connection as Partial<KafkaConnectionConfig>;
      return {
        bootstrapBrokers: kafkaConnection.bootstrapBrokers ?? decrypted.bootstrapBrokers ?? [],
        securityProtocol: kafkaConnection.securityProtocol ?? decrypted.securityProtocol ?? 'PLAINTEXT',
        saslMechanism: kafkaConnection.saslMechanism ?? decrypted.saslMechanism ?? null,
        saslUsername: kafkaConnection.saslUsername ?? decrypted.saslUsername ?? null,
        saslPassword: decrypted.saslPassword ?? null,
      };
    }

    return null;
  }

  private getConnection(config: ConnectorConfigShape): Record<string, unknown> | null {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
    const connection = (config as Record<string, unknown>).connection;
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)) return null;
    return connection as Record<string, unknown>;
  }

  private toDriverResult(result: PeekResult): DriverFactoryPeekResult {
    return {
      source: 'driver',
      messages: result.messages.map((message) => ({
        id: message.id,
        receivedAt: message.receivedAt,
        payload: message.payload,
        metadata: message.metadata,
      })),
      error: result.error,
    };
  }

  private toProbeResult(result: ProbeResult): DriverFactoryProbeResult {
    return {
      source: 'driver',
      error: result.error,
      metadata: result.metadata,
    };
  }

  private decryptBrokerConfig(payload: unknown): EncryptedBrokerConfig {
    if (typeof payload === 'string') {
      try {
        const plain = this.crypto.decryptApiKey(payload);
        const parsed = JSON.parse(plain);
        if (parsed && typeof parsed === 'object') return parsed as EncryptedBrokerConfig;
      } catch (error) {
        this.logger.warn({ msg: 'decrypt_broker_config_failed', error: (error as Error).message });
      }
      return {};
    }
    if (payload && typeof payload === 'object') return payload as EncryptedBrokerConfig;
    return {};
  }
}
