import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { StoredObjectRef } from '../../../server/common/contracts/object-storage.provider';
import type { DatasetImportRow } from '../../../server/modules/dataset/dataset-import.repository';
import { DatasetImportEmptyError } from '../../../server/modules/dataset/dataset-import.repository';
import { createDatasetRawImportRunner } from '../dataset-raw-import-runner';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const IMPORT_ID = '00000000-0000-4000-8000-000000000100';
const ACTOR_ID = '00000000-0000-4000-8000-000000000010';

const RAW_REF: StoredObjectRef = {
  provider: 'fake',
  key: 'dataset_raw/imp/input.csv',
  bytes: 128,
  resourceType: 'dataset_raw',
  resourceId: IMPORT_ID,
};

function fakeImport(overrides: Partial<DatasetImportRow> = {}): DatasetImportRow {
  return {
    id: IMPORT_ID,
    projectId: PROJECT_ID,
    datasetId: null,
    name: 'Raw dataset',
    description: null,
    fieldMappings: [
      { name: 'sample_id', role: 'id' },
      { name: 'text', role: 'text' },
      { name: 'expected_output', role: 'expected' },
    ],
    fileName: 'input.csv',
    fileSizeBytes: 128,
    contentType: 'text/csv',
    sourceFormat: 'csv',
    importMode: 'raw_object',
    rawUploadSessionId: 'upload-1',
    rawUploadExpiresAt: null,
    rawUploadCompletedAt: new Date('2026-06-20T00:00:00Z'),
    rawObjectRef: RAW_REF,
    progress: { phase: overrides.status ?? 'queued' },
    declaredTotalRows: null,
    receivedRows: 0,
    jobId: `dataset-raw-import-${IMPORT_ID}`,
    errorCode: null,
    errorMessage: null,
    status: 'queued',
    queuedAt: new Date('2026-06-20T00:00:01Z'),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    abortedAt: null,
    createdBy: ACTOR_ID,
    createdAt: new Date('2026-06-20T00:00:00Z'),
    updatedAt: new Date('2026-06-20T00:00:01Z'),
    ...overrides,
  };
}

function buildRunner(
  overrides: {
    repo?: Record<string, unknown>;
    storage?: Record<string, unknown>;
    quotaPolicy?: Record<string, unknown>;
    usageMetering?: Record<string, unknown>;
  } = {},
) {
  const repo = {
    findImportById: vi.fn().mockResolvedValue(fakeImport()),
    markParsing: vi.fn().mockResolvedValue(fakeImport({ status: 'parsing' })),
    appendBatch: vi.fn().mockResolvedValue(1),
    getSampleDataForInference: vi
      .fn()
      .mockResolvedValue([{ sample_id: 'case-1', text: 'hello', expected_output: 'pass' }]),
    markPromoting: vi.fn().mockResolvedValue(fakeImport({ status: 'importing', progress: { phase: 'finalizing' } })),
    promote: vi.fn().mockResolvedValue({ sampleCount: 1 }),
    markFailed: vi.fn().mockResolvedValue(undefined),
    clearStaging: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
    ...overrides.repo,
  };
  const storage = {
    getObjectStream: vi
      .fn()
      .mockResolvedValue(Readable.from(['sample_id,text,expected_output,ignored\ncase-1,hello,pass,nope\n'])),
    deleteObjects: vi.fn().mockResolvedValue(undefined),
    ...overrides.storage,
  };
  const quotaPolicy = {
    assertCanStore: vi.fn().mockResolvedValue(undefined),
    ...overrides.quotaPolicy,
  };
  const usageMetering = {
    record: vi.fn().mockResolvedValue(undefined),
    ...overrides.usageMetering,
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const runner = createDatasetRawImportRunner({
    repo: repo as never,
    storage: storage as never,
    quotaPolicy: quotaPolicy as never,
    usageMetering: usageMetering as never,
    logger: logger as never,
  });
  return { runner, repo, storage, quotaPolicy, usageMetering, logger };
}

const JOB_CONTEXT = { bullmqJobId: `dataset-raw-import-${IMPORT_ID}`, bullmqQueue: 'dataset-import', attempt: 1 };

describe('createDatasetRawImportRunner', () => {
  it('streams a raw object into staging, promotes it, and cleans the raw object', async () => {
    const { runner, repo, storage, quotaPolicy, usageMetering } = buildRunner();

    const result = await runner({ projectId: PROJECT_ID, importId: IMPORT_ID, actorId: ACTOR_ID }, JOB_CONTEXT);

    expect(result).toMatchObject({ importId: IMPORT_ID, status: 'completed', sampleCount: 1 });
    expect(repo.markParsing).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID);
    expect(repo.markPromoting).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID);
    expect(repo.appendBatch).toHaveBeenCalledWith(
      IMPORT_ID,
      [
        {
          rowIndex: 0,
          data: { sample_id: 'case-1', text: 'hello', expected_output: 'pass' },
          externalId: 'case-1',
        },
      ],
      1,
    );
    const promoteArgs = (repo.promote as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(promoteArgs.fieldSchema).toEqual([
      { name: 'sample_id', role: 'metadata', type: 'string' },
      { name: 'text', role: 'text', type: 'string' },
      { name: 'expected_output', role: 'expected_output', type: 'string' },
    ]);
    await promoteArgs.onProgress({ phase: 'committing', committedRows: 1 });
    expect(repo.updateProgress).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, {
      phase: 'committing',
      committedRows: 1,
    });
    expect(quotaPolicy.assertCanStore).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'dataset_raw_import_batch' }),
    );
    expect(storage.deleteObjects).toHaveBeenCalledWith([RAW_REF]);
    expect(usageMetering.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'dataset_import.completed' }),
    );
  });

  it('marks the import failed and cleans the raw object when promotion fails', async () => {
    const { runner, repo, storage } = buildRunner({
      repo: {
        getSampleDataForInference: vi.fn().mockResolvedValue([]),
        promote: vi.fn().mockRejectedValue(new DatasetImportEmptyError('empty')),
      },
      storage: {
        getObjectStream: vi.fn().mockResolvedValue(Readable.from(['sample_id,text\n'])),
      },
    });

    const result = await runner({ projectId: PROJECT_ID, importId: IMPORT_ID, actorId: ACTOR_ID }, JOB_CONTEXT);

    expect(result.status).toBe('failed');
    expect(repo.markFailed).toHaveBeenCalledWith(PROJECT_ID, IMPORT_ID, 'dataset_import_empty', 'empty');
    expect(storage.deleteObjects).toHaveBeenCalledWith([RAW_REF]);
  });

  it('treats an aborted import as cancelled instead of failed', async () => {
    const aborted = fakeImport({ status: 'aborted', abortedAt: new Date('2026-06-20T00:01:00Z') });
    const { runner, repo, storage } = buildRunner({
      repo: {
        findImportById: vi
          .fn()
          .mockResolvedValueOnce(fakeImport())
          .mockResolvedValueOnce(aborted)
          .mockResolvedValueOnce(aborted),
      },
    });

    const result = await runner({ projectId: PROJECT_ID, importId: IMPORT_ID, actorId: ACTOR_ID }, JOB_CONTEXT);

    expect(result.status).toBe('aborted');
    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(repo.clearStaging).toHaveBeenCalledWith(IMPORT_ID);
    expect(storage.deleteObjects).toHaveBeenCalledWith([RAW_REF]);
  });

  it('does not clear staging when another worker is already promoting the import', async () => {
    const promoting = fakeImport({ status: 'importing', progress: { phase: 'offloading' }, receivedRows: 1 });
    const { runner, repo, storage } = buildRunner({
      repo: {
        findImportById: vi.fn().mockResolvedValue(promoting),
      },
    });

    const result = await runner({ projectId: PROJECT_ID, importId: IMPORT_ID, actorId: ACTOR_ID }, JOB_CONTEXT);

    expect(result).toMatchObject({ importId: IMPORT_ID, status: 'importing', sampleCount: 1 });
    expect(repo.markParsing).not.toHaveBeenCalled();
    expect(repo.clearStaging).not.toHaveBeenCalled();
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });

  it('does not treat markPromoting null as aborted when promotion is already in progress', async () => {
    const promoting = fakeImport({ status: 'importing', progress: { phase: 'committing' }, receivedRows: 1 });
    const { runner, repo, storage } = buildRunner({
      repo: {
        findImportById: vi
          .fn()
          .mockResolvedValueOnce(fakeImport())
          .mockResolvedValueOnce(fakeImport({ status: 'importing' }))
          .mockResolvedValue(promoting),
        markPromoting: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await runner({ projectId: PROJECT_ID, importId: IMPORT_ID, actorId: ACTOR_ID }, JOB_CONTEXT);

    expect(result).toMatchObject({ importId: IMPORT_ID, status: 'importing', sampleCount: 1 });
    expect(repo.clearStaging).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });
});
