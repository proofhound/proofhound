// DatasetUploadService — adapter extension point (08 §3.13): receive an uploaded dataset file,
// parse it, stage the rows, and atomically promote them into a dataset.
//
// The OSS default (LocalDatasetUploadService) parses a Multer temp file synchronously in the server
// process and stores samples inline in PostgreSQL. A replacement implementation binds its own implementation
// (browser-direct-to-object-storage + async worker + offload) in its `contracts` module; that
// implementation lives outside the OSS trunk.
import type { DatasetFieldMappingDto, DatasetImportSourceFormat, DatasetImportStatusDto } from '@proofhound/shared';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

export interface DatasetUploadInput {
  /** Server-side temp file path (Multer diskStorage). The implementation deletes it when done. */
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  contentType?: string | null;
  sourceFormat: DatasetImportSourceFormat;
  name: string;
  description?: string | null;
  fieldMappings: DatasetFieldMappingDto[];
  declaredTotalRows?: number | null;
}

export abstract class DatasetUploadService {
  abstract uploadDataset(
    projectId: string,
    input: DatasetUploadInput,
    actor: CurrentUserPayload,
  ): Promise<DatasetImportStatusDto>;
}
