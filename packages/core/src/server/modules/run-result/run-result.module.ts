import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { RunResultCompactionSweeper } from './run-result-compaction-sweeper';
import { DrizzleRunResultCompactionStore, RUN_RESULT_COMPACTION_STORE, RunResultCompactor } from './run-result-compactor';
import { RunResultPayloadReader } from './run-result-payload.reader';
import { ReleaseRunResultController, RunResultController } from './run-result.controller';
import { RunResultRepository } from './run-result.repository';
import { RunResultService } from './run-result.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RunResultController, ReleaseRunResultController],
  providers: [
    RunResultRepository,
    RunResultService,
    RunResultPayloadReader,
    RunResultCompactor,
    RunResultCompactionSweeper,
    { provide: RUN_RESULT_COMPACTION_STORE, useClass: DrizzleRunResultCompactionStore },
  ],
  // RunResultPayloadReader / RunResultCompactor are exported so other modules (experiment / optimization
  // workflows, annotation, canary) can hydrate or compact without re-wiring the object-storage seam.
  exports: [RunResultService, RunResultPayloadReader, RunResultCompactor],
})
export class RunResultModule {}
