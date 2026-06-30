import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { OrchestrationModule } from '../../infrastructure/orchestration';
import { RedisModule } from '../../../shared/redis/redis.module';
import { ConnectorModule } from '../connector/connector.module';
import { ReleaseLineController } from './release-line.controller';
import { ReleaseLineRepository } from './release-line.repository';
import { ReleaseLineService } from './release-line.service';
import { ReleaseRunnerRepository } from './release-runner.repository';
import { ReleaseRunnerService } from './release-runner.service';

// ReleaseLineDeletionHook (08 §3.17) is provided by the global contracts module so an override
// `contracts` module can replace it without this feature module shadowing the binding;
// ReleaseLineService injects it from the global provider.
@Module({
  imports: [DatabaseModule, OrchestrationModule, RedisModule, ConnectorModule],
  controllers: [ReleaseLineController],
  providers: [ReleaseLineRepository, ReleaseLineService, ReleaseRunnerRepository, ReleaseRunnerService],
  exports: [ReleaseLineService],
})
export class ReleaseLineModule {}
