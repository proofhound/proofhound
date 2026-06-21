import { z } from 'zod';
import { datasetFieldMappingSchema } from './dataset.dto';

export const DATASET_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
export const DATASET_IMPORT_ZIP_MAX_FILE_BYTES = 1024 * 1024 * 1024;

export const datasetImportSourceFormatSchema = z.enum(['jsonl', 'csv', 'tsv', 'zip']);
export type DatasetImportSourceFormat = z.infer<typeof datasetImportSourceFormatSchema>;
export const datasetImportStoredSourceFormatSchema = z.enum(['jsonl', 'csv', 'tsv', 'json', 'zip']);
export type DatasetImportStoredSourceFormat = z.infer<typeof datasetImportStoredSourceFormatSchema>;

export const datasetImportStateSchema = z.enum([
  'uploading',
  'importing',
  'completed',
  'failed',
  'aborted',
]);
export type DatasetImportState = z.infer<typeof datasetImportStateSchema>;

// Backward-compatible alias while callers migrate terminology from "status" to "state".
export const datasetImportStatusSchema = datasetImportStateSchema;
export type DatasetImportStatus = DatasetImportState;

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

// One streamed batch. samples 上限沿用同步路径的每请求兜底；导入总量不设上限。
export const datasetImportBatchSchema = z.object({
  batchStartIndex: z.number().int().nonnegative(),
  samples: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
});
export type DatasetImportBatchDto = z.infer<typeof datasetImportBatchSchema>;

export const datasetImportItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  datasetId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  fileName: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  sourceFormat: datasetImportStoredSourceFormatSchema,
  declaredTotalRows: z.number().int().nonnegative().nullable(),
  receivedRows: z.number().int().nonnegative(),
  status: datasetImportStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DatasetImportItemDto = z.infer<typeof datasetImportItemSchema>;

export const datasetImportBatchResponseSchema = z.object({
  importId: z.string().uuid(),
  receivedRows: z.number().int().nonnegative(),
});
export type DatasetImportBatchResponseDto = z.infer<typeof datasetImportBatchResponseSchema>;

export const datasetImportProgressSchema = z.object({
  state: datasetImportStateSchema,
  parsedRows: z.number().int().nonnegative(),
  importedRows: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative().nullable(),
  totalBytes: z.number().int().nonnegative().nullable(),
  percentage: z.number().min(0).max(100).nullable(),
});
export type DatasetImportProgressDto = z.infer<typeof datasetImportProgressSchema>;

export const datasetImportStatusDtoSchema = datasetImportItemSchema.extend({
  state: datasetImportStateSchema,
  progress: datasetImportProgressSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  completedAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  abortedAt: z.string().datetime().nullable(),
});
export type DatasetImportStatusDto = z.infer<typeof datasetImportStatusDtoSchema>;

export const completeDatasetImportResponseSchema = datasetImportStatusDtoSchema;
export type CompleteDatasetImportResponseDto = z.infer<typeof completeDatasetImportResponseSchema>;
