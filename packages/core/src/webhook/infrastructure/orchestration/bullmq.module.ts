import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BullmqService } from './bullmq.service';

@Module({
  imports: [
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
  providers: [BullmqService],
  exports: [BullmqService],
})
export class BullmqOrchestrationModule {}
