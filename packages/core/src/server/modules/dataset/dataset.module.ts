import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { DatasetController } from './dataset.controller';
import { DatasetRepository } from './dataset.repository';
import { DatasetService } from './dataset.service';
import { DatasetUploadLimitInterceptor } from './dataset-upload-limit.interceptor';

// DatasetUploadService (08 §3.13) and DatasetDeletionHook (08 §3.15) are both provided by the global
// contracts module, so an override `contracts` module can replace either without this feature module
// shadowing the binding. The controller / service inject them directly from the global providers.
// Sample payloads are read inline from `dataset_samples.data`; there is no read seam.
@Module({
  imports: [DatabaseModule],
  controllers: [DatasetController],
  providers: [DatasetRepository, DatasetService, DatasetUploadLimitInterceptor],
  exports: [DatasetService],
})
export class DatasetModule {}
