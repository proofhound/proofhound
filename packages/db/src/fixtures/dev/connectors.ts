// Local connector fixtures: redis/kafka, each with input + output,
// plus two webhook input rows (sync + async, distinguished via config.webhookMode; type stays 'webhook').
// Business term: connector; physical table: ph_assets.connectors. See docs/specs/26-connectors.md.
//
// Internally fixtures use a `kind` field as the discriminator (convenient for seed-dev.ts switch); the actual table does not have this column,
// it is split into direction + type. The `config` shape mirrors the 6 (type, direction) config schemas in packages/shared/src/dto/connector.dto.ts.
// (no need to re-link)
//
// Note: inbound webhook tokens are not attached in this fixture; tokens are reverse-linked to the connector in fixtures/dev/api-tokens.ts via connectorId.

const REDIS_CONNECTION = {
  source: 'local_config' as const,
  host: 'localhost',
  port: 6379,
  deploymentType: 'standalone' as const,
};
const KAFKA_CONNECTION = {
  source: 'local_config' as const,
  bootstrapBrokers: ['localhost:9092'],
  securityProtocol: 'PLAINTEXT' as const,
};

const WEBHOOK_INPUT_PAYLOAD_SCHEMA = {
  type: 'object',
  properties: {
    sample_id: { type: 'string', description: 'Sample ID' },
    text: { type: 'string', description: 'Text content to be processed by the prompt' },
  },
};

export type DevConnectorFixture =
  | {
      kind: 'redis-input';
      id: string;
      name: string;
      description: string;
      config: {
        connection: typeof REDIS_CONNECTION;
        mode: 'list' | 'stream';
        key: string;
        consumerGroup?: string;
        blockMs?: number;
        batchSize?: number;
      };
    }
  | {
      kind: 'redis-output';
      id: string;
      name: string;
      description: string;
      config: {
        connection: typeof REDIS_CONNECTION;
        mode: 'list' | 'stream';
        key: string;
        maxLen?: number;
      };
    }
  | {
      kind: 'kafka-input';
      id: string;
      name: string;
      description: string;
      config: {
        connection: typeof KAFKA_CONNECTION;
        topic: string;
        consumerGroup: string;
        fromBeginning?: boolean;
        batchSize?: number;
      };
    }
  | {
      kind: 'kafka-output';
      id: string;
      name: string;
      description: string;
      config: {
        connection: typeof KAFKA_CONNECTION;
        topic: string;
        partitionKey?: string;
      };
    }
  | {
      kind: 'webhook-input';
      id: string;
      name: string;
      description: string;
      webhookPath: string;
      config: {
        webhookMode: 'sync' | 'async';
        timeoutSeconds?: number;
        expectedPayloadSchema?: Record<string, unknown>;
      };
    };

export const DEV_CONNECTORS: DevConnectorFixture[] = [
  {
    kind: 'redis-input',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    name: 'yelp-polarity-redis-list-in',
    description: 'Redis list input · 50 random Yelp Polarity samples',
    config: { connection: REDIS_CONNECTION, mode: 'list', key: 'datasets:yelp-polarity:random-50' },
  },
  {
    kind: 'redis-output',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
    name: 'decisions-list-out',
    description: 'Redis list output · decision push',
    config: { connection: REDIS_CONNECTION, mode: 'list', key: 'datasets:yelp-polarity:random-50', maxLen: 100000 },
  },
  {
    kind: 'kafka-input',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
    name: 'yelp-polarity-kafka-topic-in',
    description: 'Kafka input · 50 random Yelp Polarity samples',
    config: {
      connection: KAFKA_CONNECTION,
      topic: 'datasets.yelp-polarity.random-50',
      consumerGroup: 'yelp-polarity-dev-g1',
      fromBeginning: false,
    },
  },
  {
    kind: 'kafka-output',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
    name: 'decisions-topic-out',
    description: 'Kafka output · decisions topic',
    config: { connection: KAFKA_CONNECTION, topic: 'risk-decisions', partitionKey: 'orderId' },
  },
  {
    kind: 'webhook-input',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005',
    name: 'sync-webhook-in',
    description: 'Webhook input · sync mode (upstream POST waits for the LLM to finish before returning)',
    webhookPath: 'a3a1b2c3-d4e5-4f60-8788-aabbccddeeff',
    config: {
      webhookMode: 'sync',
      timeoutSeconds: 30,
      expectedPayloadSchema: WEBHOOK_INPUT_PAYLOAD_SCHEMA,
    },
  },
  {
    kind: 'webhook-input',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006',
    name: 'async-webhook-in',
    description: 'Webhook input · async mode (returns callId immediately; the result is retrieved via the output connector or the query API)',
    webhookPath: 'b4b2c3d4-e5f6-4071-8899-bbccddeeff00',
    config: {
      webhookMode: 'async',
      timeoutSeconds: 120,
      expectedPayloadSchema: WEBHOOK_INPUT_PAYLOAD_SCHEMA,
    },
  },
];
