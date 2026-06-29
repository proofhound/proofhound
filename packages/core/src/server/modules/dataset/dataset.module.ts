import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { DatasetDeletionHook, LocalDatasetDeletionHook } from './dataset-deletion.hook';
import { DatasetController } from './dataset.controller';
import { DatasetRepository } from './dataset.repository';
import { DatasetService } from './dataset.service';
import { DatasetImportRepository } from './dataset-import.repository';
import { LocalDatasetUploadService } from './dataset-import.service';
import { DatasetUploadInterface } from './dataset-upload.interface';

// DatasetSamplePayloadReader is provided globally by the contracts module (08 §3.14); injected directly.
@Module({
  imports: [DatabaseModule],
  controllers: [DatasetController],
  providers: [
    DatasetRepository,
    { provide: DatasetDeletionHook, useClass: LocalDatasetDeletionHook },
    DatasetService,
    DatasetImportRepository,
    LocalDatasetUploadService,
    { provide: DatasetUploadInterface, useExisting: LocalDatasetUploadService },
  ],
  exports: [DatasetService, DatasetUploadInterface],
})
export class DatasetModule {}
