import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { DatasetDeletionHook, LocalDatasetDeletionHook } from './dataset-deletion.hook';
import { DatasetImportController } from './dataset-import.controller';
import { DatasetImportRepository } from './dataset-import.repository';
import { DatasetImportService } from './dataset-import.service';
import { DatasetController } from './dataset.controller';
import { DatasetRepository } from './dataset.repository';
import { DatasetService } from './dataset.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DatasetController, DatasetImportController],
  providers: [
    DatasetRepository,
    { provide: DatasetDeletionHook, useClass: LocalDatasetDeletionHook },
    DatasetService,
    DatasetImportRepository,
    DatasetImportService,
  ],
  exports: [DatasetService, DatasetImportService],
})
export class DatasetModule {}
