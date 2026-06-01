import { Module } from '@nestjs/common';
import { ConnectorContextResolver } from '../../../server/common/contracts/connector-context.resolver';
import {
  LocalWorkflowAuthorizationHook,
  WorkflowAuthorizationHook,
} from '../../../server/common/contracts/workflow-authorization.hook';
import { DatabaseModule } from '../../../shared/database/database.module';
import { BullmqOrchestrationModule } from '../../infrastructure/orchestration/bullmq.module';
import { RedisModule } from '../../../shared/redis/redis.module';
import { LocalConnectorContextResolver } from './local-connector-context.resolver';
import { WebhookController } from './webhook.controller';
import { WebhookRepository } from './webhook.repository';
import { WebhookService } from './webhook.service';

@Module({
  imports: [DatabaseModule, BullmqOrchestrationModule, RedisModule],
  controllers: [WebhookController],
  providers: [
    WebhookRepository,
    WebhookService,
    { provide: ConnectorContextResolver, useClass: LocalConnectorContextResolver },
    { provide: WorkflowAuthorizationHook, useClass: LocalWorkflowAuthorizationHook },
  ],
})
export class WebhookModule {}
