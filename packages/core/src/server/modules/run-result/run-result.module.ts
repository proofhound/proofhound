import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { ReleaseRunResultController, RunResultController } from './run-result.controller';
import { RunResultRepository } from './run-result.repository';
import { RunResultService } from './run-result.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RunResultController, ReleaseRunResultController],
  providers: [RunResultRepository, RunResultService],
  exports: [RunResultService],
})
export class RunResultModule {}
