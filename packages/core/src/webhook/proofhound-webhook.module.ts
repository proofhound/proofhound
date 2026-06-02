import { Module, type DynamicModule } from '@nestjs/common';
import { WebhookModule } from './channels/webhook/webhook.module';
import { HealthController } from '../shared/health/health.controller';
import { HealthService } from '../shared/health/health.service';
import { DatabaseModule } from '../shared/database/database.module';
import { RedisModule } from '../shared/redis/redis.module';
import type { ProofHoundRuntimeModuleOptions } from '../shared/runtime-module-options';

export type ProofHoundWebhookModuleOptions = ProofHoundRuntimeModuleOptions;

@Module({})
export class ProofHoundWebhookModule {
  static forRoot(options: ProofHoundWebhookModuleOptions): DynamicModule {
    return {
      module: ProofHoundWebhookModule,
      imports: [options.contracts, DatabaseModule, RedisModule, WebhookModule],
      controllers: [HealthController],
      providers: [HealthService],
    };
  }
}
