import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LlmConsumer, llmConsumerProviders } from './consumers/llm.consumer';
import { ProbeConsumer } from './consumers/probe.consumer';
import { DatabaseModule } from '../shared/database/database.module';
import { RedisModule } from '../shared/redis/redis.module';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1_000 },
        },
      }),
    }),
    BullModule.registerQueue({ name: 'llm' }, { name: 'probe' }),
  ],
  providers: [...llmConsumerProviders, LlmConsumer, ProbeConsumer],
})
export class ProofHoundWorkerModule {}
