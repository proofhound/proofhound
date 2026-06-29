import { z } from 'zod';
import { datasetFieldMappingSchema } from './dataset.dto';

// Single source of truth for the OSS dataset upload cap (env-overridable on the backend; a coarse
// safety ceiling). Per-plan limits are enforced by QuotaPolicyHook (backend) and the UI's injected
// WebContracts.datasetUploadMaxBytes, not by raising this constant.
export const DATASET_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const DATASET_IMPORT_MAX_FILE_BYTES = DATASET_UPLOAD_MAX_BYTES;
export const DATASET_IMPORT_ZIP_MAX_FILE_BYTES = DATASET_UPLOAD_MAX_BYTES;

export const datasetImportSourceFormatSchema = z.enum(['jsonl', 'csv', 'tsv', 'json', 'zip']);
export type DatasetImportSourceFormat = z.infer<typeof datasetImportSourceFormatSchema>;

export const datasetImportStateSchema = z.enum(['created', 'importing', 'completed', 'failed', 'aborted']);
export type DatasetImportState = z.infer<typeof datasetImportStateSchema>;

// Backward-compatible alias while callers migrate terminology from "status" to "state".
export const datasetImportStatusSchema = datasetImportStateSchema;
export type DatasetImportStatus = DatasetImportState;

export const datasetImportProgressPhaseSchema = z.enum([
  'created',
  'importing',
  'finalizing',
  'committing',
  'completed',
  'failed',
  'aborted',
]);
export type DatasetImportProgressPhase = z.infer<typeof datasetImportProgressPhaseSchema>;

export const datasetImportSourceFileSchema = z.object({
  fileName: z.string().trim().min(1).max(260),
  fileSizeBytes: z.number().int().nonnegative(),
  contentType: z.string().trim().max(120).optional(),
});
export type DatasetImportSourceFileDto = z.infer<typeof datasetImportSourceFileSchema>;

export const createDatasetImportSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional().nullable(),
    fieldMappings: z.array(datasetFieldMappingSchema).min(1).max(200),
    sourceFile: datasetImportSourceFileSchema,
    sourceFormat: datasetImportSourceFormatSchema,
    declaredTotalRows: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    const expectedFields = value.fieldMappings.filter((field) => field.role === 'expected');
    if (expectedFields.length > 1) {
      ctx.addIssue({ code: 'custom', path: ['fieldMappings'], message: 'dataset_expected_field_unique' });
    }

    const maxBytes =
      value.sourceFormat === 'zip' ? DATASET_IMPORT_ZIP_MAX_FILE_BYTES : DATASET_IMPORT_MAX_FILE_BYTES;
    if (value.sourceFile.fileSizeBytes > maxBytes) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceFile', 'fileSizeBytes'],
        message: 'dataset_import_file_too_large',
      });
    }
  });
export type CreateDatasetImportDto = z.infer<typeof createDatasetImportSchema>;

// Multipart upload metadata (OSS UI path, SPEC 22 §3.1.1). The file itself rides as the multipart
// `file` part; these are the accompanying form fields. `fieldMappings` arrives as a JSON string and
// is parsed by the controller before validation.
export const datasetUploadMetadataSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional().nullable(),
  fieldMappings: z.array(datasetFieldMappingSchema).min(1).max(200),
  sourceFormat: datasetImportSourceFormatSchema,
  declaredTotalRows: z.number().int().nonnegative().optional(),
  fileName: z.string().trim().min(1).max(260).optional(),
});
export type DatasetUploadMetadataDto = z.infer<typeof datasetUploadMetadataSchema>;

export const datasetImportItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  datasetId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  fileName: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  sourceFormat: datasetImportSourceFormatSchema,
  declaredTotalRows: z.number().int().nonnegative().nullable(),
  receivedRows: z.number().int().nonnegative(),
  status: datasetImportStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DatasetImportItemDto = z.infer<typeof datasetImportItemSchema>;

export const datasetImportProgressSchema = z.object({
  state: datasetImportStateSchema,
  phase: datasetImportProgressPhaseSchema.nullable(),
  uploadedBytes: z.number().int().nonnegative().nullable(),
  parsedRows: z.number().int().nonnegative(),
  importedRows: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative().nullable(),
  totalBytes: z.number().int().nonnegative().nullable(),
  committedRows: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100).nullable(),
});
export type DatasetImportProgressDto = z.infer<typeof datasetImportProgressSchema>;

export const datasetImportStatusDtoSchema = datasetImportItemSchema.extend({
  state: datasetImportStateSchema,
  progress: datasetImportProgressSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  queuedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  abortedAt: z.string().datetime().nullable(),
});
export type DatasetImportStatusDto = z.infer<typeof datasetImportStatusDtoSchema>;
