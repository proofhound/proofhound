import { Module, type DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatasetRawImportConsumer } from './consumers/dataset-raw-import.consumer';
import { LlmConsumer, llmConsumerProviders } from './consumers/llm.consumer';
import { ProbeConsumer } from './consumers/probe.consumer';
import { DatabaseModule } from '../shared/database/database.module';
import { LlmAdmissionStore } from '../shared/llm-admission/llm-admission.store';
import { RedisModule } from '../shared/redis/redis.module';
import type { ProofHoundRuntimeModuleOptions } from '../shared/runtime-module-options';
import { DatasetImportRepository } from '../server/modules/dataset/dataset-import.repository';
import { LlmAdmissionDispatcher } from './llm-admission-dispatcher';

export type ProofHoundWorkerModuleOptions = ProofHoundRuntimeModuleOptions;

@Module({})
export class ProofHoundWorkerModule {
  static forRoot(options: ProofHoundWorkerModuleOptions): DynamicModule {
    return {
      module: ProofHoundWorkerModule,
      imports: [
        options.contracts,
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
        BullModule.registerQueue({ name: 'llm' }, { name: 'probe' }, { name: 'dataset-import' }),
      ],
      providers: [
        DatasetImportRepository,
        LlmAdmissionStore,
        LlmAdmissionDispatcher,
        ...llmConsumerProviders,
        LlmConsumer,
        ProbeConsumer,
        DatasetRawImportConsumer,
      ],
    };
  }
}
