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
  // Run-result payloads are stored and read inline from the row; there is no read seam or object-storage
  // compaction in the OSS trunk (SPEC 30 §9).
  exports: [RunResultService],
})
export class RunResultModule {}
