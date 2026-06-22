import { z } from 'zod';

export const datasetIdParamSchema = z.string().uuid();

export const datasetStatusSchema = z.enum(['active', 'archived']);
export type DatasetStatusDto = z.infer<typeof datasetStatusSchema>;

export const datasetExportFormatSchema = z.enum(['csv', 'jsonl']);
export type DatasetExportFormatDto = z.infer<typeof datasetExportFormatSchema>;

export const datasetFieldRoleSchema = z.enum(['id', 'text', 'image', 'expected', 'metadata']);
export type DatasetFieldRole = z.infer<typeof datasetFieldRoleSchema>;

export const datasetFieldSchemaRoleSchema = z.enum([
  'text',
  'image',
  'image_url',
  'image_base64',
  'expected_output',
  'metadata',
]);
export type DatasetFieldSchemaRole = z.infer<typeof datasetFieldSchemaRoleSchema>;

export const datasetFieldMappingSchema = z.object({
  name: z.string().trim().min(1).max(160),
  role: datasetFieldRoleSchema,
});
export type DatasetFieldMappingDto = z.infer<typeof datasetFieldMappingSchema>;

export const datasetFieldSchema = z.object({
  name: z.string(),
  role: datasetFieldSchemaRoleSchema,
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null', 'unknown']),
});
export type DatasetFieldSchemaDto = z.infer<typeof datasetFieldSchema>;

export const datasetCategoryDistributionItemSchema = z.object({
  label: z.string(),
  count: z.number().int().nonnegative(),
});
export type DatasetCategoryDistributionItemDto = z.infer<typeof datasetCategoryDistributionItemSchema>;

export const datasetCategoryDistributionSchema = z.object({
  field: z.string().nullable(),
  total: z.number().int().nonnegative(),
  categories: z.array(datasetCategoryDistributionItemSchema),
});
export type DatasetCategoryDistributionDto = z.infer<typeof datasetCategoryDistributionSchema>;

export const datasetReferencesSchema = z.object({
  experiments: z.number().int().nonnegative(),
  optimizations: z.number().int().nonnegative(),
});
export type DatasetReferencesDto = z.infer<typeof datasetReferencesSchema>;

export const datasetUploadSourceSchema = z.object({
  fileName: z.string().trim().min(1).max(260),
  fileSizeBytes: z.number().int().nonnegative(),
  contentType: z.string().trim().max(120).optional(),
});
export type DatasetUploadSourceDto = z.infer<typeof datasetUploadSourceSchema>;

export const createDatasetSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional().nullable(),
    uploadSource: datasetUploadSourceSchema,
    fieldMappings: z.array(datasetFieldMappingSchema).min(1).max(200),
    samples: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
  })
  .superRefine((value, ctx) => {
    const expectedFields = value.fieldMappings.filter((field) => field.role === 'expected');
    if (expectedFields.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['fieldMappings'],
        message: 'dataset_expected_field_unique',
      });
    }
  });
export type CreateDatasetDto = z.infer<typeof createDatasetSchema>;

export const updateDatasetMetadataSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional().nullable(),
    fieldMappings: z.array(datasetFieldMappingSchema).min(1).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    const expectedFields = value.fieldMappings?.filter((field) => field.role === 'expected') ?? [];
    if (expectedFields.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['fieldMappings'],
        message: 'dataset_expected_field_unique',
      });
    }
  });
export type UpdateDatasetMetadataDto = z.infer<typeof updateDatasetMetadataSchema>;

export const datasetListItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  status: datasetStatusSchema,
  description: z.string().nullable(),
  sampleCount: z.number().int().nonnegative(),
  fieldSchema: z.array(datasetFieldSchema),
  categoryDistribution: datasetCategoryDistributionSchema,
  references: datasetReferencesSchema,
  hasImages: z.boolean(),
  storagePrefix: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdByDisplayName: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
});
export type DatasetListItemDto = z.infer<typeof datasetListItemSchema>;

export const datasetDeletionImpactItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['experiment', 'optimization']),
  name: z.string().nullable(),
  status: z.string().nullable(),
  datasetId: z.string().uuid().nullable(),
  promptId: z.string().uuid().nullable(),
  promptVersionId: z.string().uuid().nullable(),
  promptVersionNumber: z.number().int().positive().nullable(),
  createdAt: z.string().datetime().nullable(),
});
export type DatasetDeletionImpactItemDto = z.infer<typeof datasetDeletionImpactItemSchema>;

export const datasetDeletionImpactSchema = z.object({
  datasetId: z.string().uuid(),
  experiments: z.array(datasetDeletionImpactItemSchema),
  optimizations: z.array(datasetDeletionImpactItemSchema),
  total: z.number().int().nonnegative(),
});
export type DatasetDeletionImpactDto = z.infer<typeof datasetDeletionImpactSchema>;

export const datasetSampleSchema = z.object({
  id: z.string().uuid(),
  datasetId: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
  externalId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DatasetSampleDto = z.infer<typeof datasetSampleSchema>;

export const datasetCreateResponseSchema = z.object({
  dataset: datasetListItemSchema,
  sampleCount: z.number().int().nonnegative(),
});
export type DatasetCreateResponseDto = z.infer<typeof datasetCreateResponseSchema>;

export const datasetSamplesListResponseSchema = z.object({
  data: z.array(datasetSampleSchema),
  total: z.number().int().nonnegative(),
});
export type DatasetSamplesListResponseDto = z.infer<typeof datasetSamplesListResponseSchema>;

// Detail page samples are server-paginated (datasets can be very large). `search` matches across the sample JSON.
export const datasetSamplesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(200).optional(),
});
export type DatasetSamplesQueryDto = z.infer<typeof datasetSamplesQuerySchema>;

export const deleteDatasetSamplesSchema = z.object({
  sampleIds: z.array(z.string().uuid()).min(1).max(5000),
});
export type DeleteDatasetSamplesDto = z.infer<typeof deleteDatasetSamplesSchema>;

export const deleteDatasetSamplesResponseSchema = z.object({
  deleted: z.number().int().nonnegative(),
});
export type DeleteDatasetSamplesResponseDto = z.infer<typeof deleteDatasetSamplesResponseSchema>;
