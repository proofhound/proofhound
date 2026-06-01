import { Module } from '@nestjs/common';
import { BullmqOrchestrationModule } from './bullmq.module';
import { DbosModule } from './dbos.module';

@Module({
  imports: [DbosModule, BullmqOrchestrationModule],
  exports: [DbosModule, BullmqOrchestrationModule],
})
export class OrchestrationModule {}
