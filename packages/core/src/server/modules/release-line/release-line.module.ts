import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { OrchestrationModule } from '../../infrastructure/orchestration';
import { RedisModule } from '../../../shared/redis/redis.module';
import { ConnectorModule } from '../connector/connector.module';
import { ReleaseLineController } from './release-line.controller';
import { LocalReleaseLineDeletionHook, ReleaseLineDeletionHook } from './release-line-deletion.hook';
import { ReleaseLineRepository } from './release-line.repository';
import { ReleaseLineService } from './release-line.service';
import { ReleaseRunnerRepository } from './release-runner.repository';
import { ReleaseRunnerService } from './release-runner.service';

@Module({
  imports: [DatabaseModule, OrchestrationModule, RedisModule, ConnectorModule],
  controllers: [ReleaseLineController],
  providers: [
    ReleaseLineRepository,
    ReleaseLineService,
    ReleaseRunnerRepository,
    ReleaseRunnerService,
    { provide: ReleaseLineDeletionHook, useClass: LocalReleaseLineDeletionHook },
  ],
  exports: [ReleaseLineService],
})
export class ReleaseLineModule {}
