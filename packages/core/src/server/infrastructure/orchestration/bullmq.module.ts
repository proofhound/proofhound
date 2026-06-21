import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullmqService } from './bullmq.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' },
        // SPEC 03 §4.2: LLM jobs use 5 retries + exponential backoff 1s→32s by default. defaultJobOptions must be
        // configured on the producer-side Queue instance; equivalent config on the worker side does not retroactively affect jobs enqueued by the server.
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
