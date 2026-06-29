import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { RunResultRetentionSweeper } from './run-result-retention-sweeper';
import { ReleaseRunResultController, RunResultController } from './run-result.controller';
import { RunResultRepository } from './run-result.repository';
import { RunResultService } from './run-result.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RunResultController, ReleaseRunResultController],
  providers: [RunResultRepository, RunResultService, RunResultRetentionSweeper],
  // RunResultPayloadReader / DatasetSamplePayloadReader are provided globally by the contracts module
  // (08 §3.14); modules inject them directly. There is no object-storage compaction in the OSS trunk.
  exports: [RunResultService],
})
export class RunResultModule {}
