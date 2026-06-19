import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { ReleaseLineModule } from '../release-line/release-line.module';
import { RunResultModule } from '../run-result/run-result.module';
import { CanaryReleaseController } from './canary-release.controller';
import { CanaryReleaseRepository } from './canary-release.repository';
import { CanaryReleaseService } from './canary-release.service';

@Module({
  imports: [DatabaseModule, ReleaseLineModule, RunResultModule],
  controllers: [CanaryReleaseController],
  providers: [CanaryReleaseRepository, CanaryReleaseService],
  exports: [CanaryReleaseService],
})
export class CanaryReleaseModule {}
