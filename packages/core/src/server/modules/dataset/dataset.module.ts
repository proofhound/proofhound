import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { DatasetDeletionHook, LocalDatasetDeletionHook } from './dataset-deletion.hook';
import { DatasetController } from './dataset.controller';
import { DatasetRepository } from './dataset.repository';
import { DatasetService } from './dataset.service';

// DatasetUploadInterface (+ its OSS LocalDatasetUploadService impl and DatasetImportRepository) and the
// DatasetSamplePayloadReader are provided by the global contracts module (08 §3.13/§3.14), so an override
// `contracts` module can replace them without this feature module shadowing the binding. The controller
// injects DatasetUploadInterface directly from the global provider.
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
