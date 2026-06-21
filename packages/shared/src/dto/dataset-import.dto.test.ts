import { describe, expect, it } from 'vitest';
import {
  DATASET_IMPORT_MAX_FILE_BYTES,
  DATASET_IMPORT_ZIP_MAX_FILE_BYTES,
  createDatasetImportSchema,
  datasetImportItemSchema,
} from './dataset-import.dto';

function createPayload(sourceFormat: unknown, fileSizeBytes: number) {
  return {
    name: 'dataset import',
    fieldMappings: [{ name: 'question', role: 'text' }],
    sourceFile: { fileName: `dataset.${String(sourceFormat)}`, fileSizeBytes },
    sourceFormat,
  };
}

describe('createDatasetImportSchema', () => {
  it('accepts the supported import formats only', () => {
    for (const format of ['csv', 'tsv', 'jsonl', 'zip']) {
      expect(createDatasetImportSchema.safeParse(createPayload(format, 1024)).success).toBe(true);
    }

    expect(createDatasetImportSchema.safeParse(createPayload('json', 1024)).success).toBe(false);
  });

  it('enforces source file size limits by format', () => {
    expect(createDatasetImportSchema.safeParse(createPayload('csv', DATASET_IMPORT_MAX_FILE_BYTES)).success).toBe(true);
    expect(createDatasetImportSchema.safeParse(createPayload('csv', DATASET_IMPORT_MAX_FILE_BYTES + 1)).success).toBe(
      false,
    );
    expect(createDatasetImportSchema.safeParse(createPayload('zip', DATASET_IMPORT_ZIP_MAX_FILE_BYTES)).success).toBe(
      true,
    );
    expect(
      createDatasetImportSchema.safeParse(createPayload('zip', DATASET_IMPORT_ZIP_MAX_FILE_BYTES + 1)).success,
    ).toBe(false);
  });

  it('keeps historical JSON import rows readable without accepting new JSON uploads', () => {
    expect(
      datasetImportItemSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        datasetId: null,
        name: 'legacy json import',
        description: null,
        fileName: 'legacy.json',
        fileSizeBytes: 1024,
        sourceFormat: 'json',
        declaredTotalRows: null,
        receivedRows: 0,
        status: 'aborted',
        createdAt: '2026-06-21T00:00:00.000Z',
        updatedAt: '2026-06-21T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
