import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LimiterKeyStrategy, LocalLimiterKeyStrategy } from '../server/common/contracts/limiter-key.strategy';
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
  // The worker is not a forRoot({contracts}) consumer; bind the limiter-key strategy directly.
  // SaaS swaps this for an org-scoped strategy in its own worker shell.
  providers: [
    ...llmConsumerProviders,
    LlmConsumer,
    ProbeConsumer,
    { provide: LimiterKeyStrategy, useClass: LocalLimiterKeyStrategy },
  ],
})
export class ProofHoundWorkerModule {}
