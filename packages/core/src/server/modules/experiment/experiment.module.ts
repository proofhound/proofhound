import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { OrchestrationModule } from '../../infrastructure/orchestration/orchestration.module';
import { ModelModule } from '../model/model.module';
import { RunResultModule } from '../run-result/run-result.module';
import { ExperimentController } from './experiment.controller';
import { ExperimentLauncher } from './experiment.launcher';
import { ExperimentRecoveryService } from './experiment.recovery';
import { ExperimentRepository } from './experiment.repository';
import { ExperimentService } from './experiment.service';
import { ExperimentWorkflowRegistrar } from './experiment.workflow';

@Module({
  imports: [DatabaseModule, ModelModule, OrchestrationModule, RunResultModule],
  controllers: [ExperimentController],
  providers: [
    ExperimentRepository,
    ExperimentService,
    ExperimentWorkflowRegistrar,
    ExperimentLauncher,
    ExperimentRecoveryService,
  ],
  exports: [ExperimentService, ExperimentLauncher, ExperimentRepository, ExperimentWorkflowRegistrar],
})
export class ExperimentModule {}
