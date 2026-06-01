import { Module } from '@nestjs/common';
import { WebhookModule } from './channels/webhook/webhook.module';
import { HealthController } from '../shared/health/health.controller';
import { HealthService } from '../shared/health/health.service';
import { DatabaseModule } from '../shared/database/database.module';
import { RedisModule } from '../shared/redis/redis.module';

@Module({
  imports: [DatabaseModule, RedisModule, WebhookModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class ProofHoundWebhookModule {}
