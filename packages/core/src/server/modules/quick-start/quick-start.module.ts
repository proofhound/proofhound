import { Module } from '@nestjs/common';
import { OptimizationModule } from '../optimization/optimization.module';
import { DatasetModule } from '../dataset/dataset.module';
import { ModelModule } from '../model/model.module';
import { QuickStartController } from './quick-start.controller';
import { QuickStartService } from './quick-start.service';

@Module({
  imports: [DatasetModule, ModelModule, OptimizationModule],
  controllers: [QuickStartController],
  providers: [QuickStartService],
  exports: [QuickStartService],
})
export class QuickStartModule {}
