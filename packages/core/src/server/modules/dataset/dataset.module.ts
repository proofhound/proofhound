import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { DatasetDeletionHook, LocalDatasetDeletionHook } from './dataset-deletion.hook';
import { DatasetController } from './dataset.controller';
import { DatasetRepository } from './dataset.repository';
import { DatasetService } from './dataset.service';

// DatasetUploadService (+ its OSS LocalDatasetUploadService impl and DatasetImportRepository) is provided
// by the global contracts module (08 §3.13), so an override `contracts` module can replace it without this
// feature module shadowing the binding. The controller injects DatasetUploadService directly from the
// global provider. Sample payloads are read inline from `dataset_samples.data`; there is no read seam.
@Module({
  imports: [DatabaseModule],
  controllers: [DatasetController],
  providers: [
    DatasetRepository,
    { provide: DatasetDeletionHook, useClass: LocalDatasetDeletionHook },
    DatasetService,
  ],
  exports: [DatasetService],
})
export class DatasetModule {}
