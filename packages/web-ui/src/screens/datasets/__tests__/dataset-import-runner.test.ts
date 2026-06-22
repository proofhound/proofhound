import type { DatasetImportClient } from '@proofhound/api-client';
import type { CreateDatasetImportDto, DatasetImportState, DatasetImportStatusDto } from '@proofhound/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  estimateDatasetImportBatchBytes,
  projectSampleRowsToBatches,
  runDatasetImport,
  runRawDatasetImport,
  type DatasetImportProgress,
} from '../dataset-import-runner';

const PROJECT_ID = '77777777-7777-4777-8777-777777777777';

const CREATE_BODY: CreateDatasetImportDto = {
  name: 'big-dataset',
  fieldMappings: [{ name: 'id', role: 'id' }],
  sourceFile: { fileName: 'train.jsonl', fileSizeBytes: 1_000_000 },
  sourceFormat: 'jsonl',
};

function fakeClient(overrides: Partial<DatasetImportClient> = {}): DatasetImportClient {
  return {
    getDatasetImport: vi.fn(),
    createDatasetImport: vi.fn().mockResolvedValue({ id: 'imp-1' }),
    appendDatasetImportBatch: vi.fn(),
    completeRawDatasetUpload: vi.fn(),
    completeDatasetImport: vi.fn().mockResolvedValue(importStatus('completed', { receivedRows: 3 })),
    abortDatasetImport: vi.fn().mockResolvedValue(undefined),
    getRawImportCapabilities: vi.fn(),
    createRawDatasetImport: vi.fn(),
    uploadRawDatasetFile: vi.fn(),
    ...overrides,
  } as unknown as DatasetImportClient;
}

function importStatus(
  state: DatasetImportState,
  overrides: Partial<DatasetImportStatusDto> = {},
): DatasetImportStatusDto {
  return {
    id: 'imp-raw-1',
    projectId: PROJECT_ID,
    datasetId: state === 'completed' ? 'ds-1' : null,
    importMode: 'raw_object',
    name: CREATE_BODY.name,
    description: null,
    fileName: CREATE_BODY.sourceFile.fileName,
    fileSizeBytes: CREATE_BODY.sourceFile.fileSizeBytes,
    sourceFormat: CREATE_BODY.sourceFormat,
    declaredTotalRows: null,
    receivedRows: 0,
    status: state,
    state,
    progress: {
      state,
      phase: state,
      uploadedBytes: state === 'uploading' ? null : CREATE_BODY.sourceFile.fileSizeBytes,
      parsedRows: overrides.receivedRows ?? 0,
      importedRows: state === 'completed' ? (overrides.receivedRows ?? 0) : 0,
      totalRows: null,
      totalBytes: CREATE_BODY.sourceFile.fileSizeBytes,
      totalShards: null,
      completedShards: null,
      committedRows: state === 'completed' ? (overrides.receivedRows ?? 0) : 0,
      percentage: state === 'completed' ? 100 : null,
    },
    errorCode: null,
    errorMessage: null,
    jobId: null,
    rawUploadCompletedAt: null,
    queuedAt: null,
    startedAt: null,
    completedAt: state === 'completed' ? '2026-06-20T00:01:00.000Z' : null,
    failedAt: null,
    abortedAt: null,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

async function* batchesOf(...batches: Array<Array<Record<string, unknown>>>) {
  for (const batch of batches) yield batch;
}

async function* rowsOf(...rows: Array<Record<string, unknown>>) {
  for (const row of rows) yield row;
}

describe('runDatasetImport', () => {
  it('creates, appends batches in order, then completes', async () => {
    const client = fakeClient();
    (client.appendDatasetImportBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ importId: 'imp-1', receivedRows: 2 })
      .mockResolvedValueOnce({ importId: 'imp-1', receivedRows: 3 });
    const progress: DatasetImportProgress[] = [];

    const result = await runDatasetImport({
      projectId: PROJECT_ID,
      createBody: CREATE_BODY,
      batches: batchesOf([{ a: 1 }, { a: 2 }], [{ a: 3 }]),
      client,
      onProgress: (p) => progress.push(p),
    });

    expect(client.createDatasetImport).toHaveBeenCalledWith(PROJECT_ID, CREATE_BODY);
    expect(client.appendDatasetImportBatch).toHaveBeenNthCalledWith(1, PROJECT_ID, 'imp-1', {
      batchStartIndex: 0,
      samples: [{ a: 1 }, { a: 2 }],
    });
    expect(client.appendDatasetImportBatch).toHaveBeenNthCalledWith(2, PROJECT_ID, 'imp-1', {
      batchStartIndex: 2,
      samples: [{ a: 3 }],
    });
    expect(client.completeDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-1');
    expect(client.abortDatasetImport).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'completed', datasetId: 'ds-1', receivedRows: 3 });
    expect(progress).toEqual([
      { phase: 'uploading', receivedRows: 2 },
      { phase: 'uploading', receivedRows: 3 },
      { phase: 'completing', receivedRows: 3 },
    ]);
  });

  it('aborts and cleans up when the signal is already aborted', async () => {
    const client = fakeClient();
    const controller = new AbortController();
    controller.abort();

    await expect(
      runDatasetImport({
        projectId: PROJECT_ID,
        createBody: CREATE_BODY,
        batches: batchesOf([{ a: 1 }]),
        signal: controller.signal,
        client,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(client.appendDatasetImportBatch).not.toHaveBeenCalled();
    expect(client.completeDatasetImport).not.toHaveBeenCalled();
    expect(client.abortDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-1');
  });

  it('cleans up the session when a batch append fails, and rethrows', async () => {
    const client = fakeClient();
    (client.appendDatasetImportBatch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));

    await expect(
      runDatasetImport({
        projectId: PROJECT_ID,
        createBody: CREATE_BODY,
        batches: batchesOf([{ a: 1 }]),
        client,
      }),
    ).rejects.toThrow('network');

    expect(client.completeDatasetImport).not.toHaveBeenCalled();
    expect(client.abortDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-1');
  });

  it('polls visible server progress while batch completion is still running', async () => {
    const offloadingStatus = importStatus('importing', {
      receivedRows: 3,
      progress: {
        state: 'importing',
        phase: 'offloading',
        uploadedBytes: CREATE_BODY.sourceFile.fileSizeBytes,
        parsedRows: 3,
        importedRows: 2,
        totalRows: 3,
        totalBytes: CREATE_BODY.sourceFile.fileSizeBytes,
        totalShards: 2,
        completedShards: 1,
        committedRows: 2,
        percentage: 94,
      },
    });
    const client = fakeClient({
      completeDatasetImport: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return importStatus('completed', { receivedRows: 3 });
      }),
      getDatasetImport: vi
        .fn()
        .mockResolvedValueOnce(offloadingStatus)
        .mockResolvedValue(importStatus('completed', { receivedRows: 3 })),
    });
    (client.appendDatasetImportBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      importId: 'imp-1',
      receivedRows: 3,
    });
    const progress: DatasetImportProgress[] = [];

    const result = await runDatasetImport({
      projectId: PROJECT_ID,
      createBody: CREATE_BODY,
      batches: batchesOf([{ a: 1 }, { a: 2 }, { a: 3 }]),
      client,
      onProgress: (event) => progress.push(event),
      pollIntervalMs: 5,
    });

    expect(client.getDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-1');
    expect(result).toMatchObject({ status: 'completed', receivedRows: 3 });
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'offloading',
          receivedRows: 3,
          status: expect.objectContaining({
            progress: expect.objectContaining({ totalShards: 2, completedShards: 1, committedRows: 2 }),
          }),
        }),
      ]),
    );
  });

  it('projects streamed rows into batches bounded by rows and encoded bytes', async () => {
    const rowA = { id: 'a', text: 'x'.repeat(80), ignored: 'drop' };
    const rowB = { id: 'b', text: 'y'.repeat(80), ignored: 'drop' };
    const maxBytes = estimateDatasetImportBatchBytes([{ id: 'a', text: rowA.text }]);

    const batches: Array<Array<Record<string, unknown>>> = [];
    for await (const batch of projectSampleRowsToBatches(rowsOf(rowA, rowB), ['id', 'text'], {
      maxRows: 1000,
      maxBytes,
    })) {
      batches.push(batch);
    }

    expect(batches).toEqual([[{ id: 'a', text: rowA.text }], [{ id: 'b', text: rowB.text }]]);
    expect(batches.every((batch) => estimateDatasetImportBatchBytes(batch) <= maxBytes)).toBe(true);
  });

  it('does not stringify the growing batch on every projected row', async () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify');
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: `case-${index}`, text: 'x'.repeat(16) }));
    let totalRows = 0;
    let stringifyCalls = 0;

    try {
      for await (const batch of projectSampleRowsToBatches(rowsOf(...rows), ['id', 'text'], {
        maxRows: 1000,
        maxBytes: 1024 * 1024,
      })) {
        totalRows += batch.length;
      }
      stringifyCalls = stringifySpy.mock.calls.length;
    } finally {
      stringifySpy.mockRestore();
    }

    expect(totalRows).toBe(100);
    expect(stringifyCalls).toBeLessThanOrEqual(105);
  });
});

describe('runRawDatasetImport', () => {
  it('creates a raw upload session, uploads the file, then completes', async () => {
    const file = new Blob(['sample_id,text\ncase-1,hello\n'], { type: 'text/csv' });
    const client = fakeClient({
      createRawDatasetImport: vi.fn().mockResolvedValue({
        import: { id: 'imp-raw-1' },
        uploadSession: {
          sessionId: 'up-1',
          url: 'https://storage.example/upload',
          expiresAt: new Date().toISOString(),
        },
        maxBytes: 2_147_483_648,
      }),
      uploadRawDatasetFile: vi.fn().mockResolvedValue(undefined),
      completeRawDatasetUpload: vi.fn().mockResolvedValue(importStatus('uploaded')),
      completeDatasetImport: vi.fn().mockResolvedValue(importStatus('queued')),
      getDatasetImport: vi.fn().mockResolvedValue(importStatus('completed', { receivedRows: 1 })),
    });
    const onUploaded = vi.fn();
    const onUploadProgress = vi.fn();
    const progress: DatasetImportProgress[] = [];

    const result = await runRawDatasetImport({
      projectId: PROJECT_ID,
      createBody: {
        ...CREATE_BODY,
        sourceFile: { fileName: 'train.csv', fileSizeBytes: file.size },
        sourceFormat: 'csv',
      },
      file,
      client,
      onUploaded,
      onUploadProgress,
      onProgress: (event) => progress.push(event),
      pollIntervalMs: 0,
    });

    expect(client.createRawDatasetImport).toHaveBeenCalled();
    expect(client.uploadRawDatasetFile).toHaveBeenCalledWith(
      { sessionId: 'up-1', url: 'https://storage.example/upload', expiresAt: expect.any(String) },
      file,
      { signal: undefined, onProgress: onUploadProgress },
    );
    expect(client.completeRawDatasetUpload).toHaveBeenCalledWith(PROJECT_ID, 'imp-raw-1');
    expect(client.completeDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-raw-1');
    expect(client.getDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-raw-1');
    expect(client.abortDatasetImport).not.toHaveBeenCalled();
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'completed', datasetId: 'ds-1' });
    expect(progress.map((event) => event.phase)).toEqual(['queued', 'completed']);
  });

  it('forwards raw upload byte progress from the client', async () => {
    const file = new Blob(['sample_id,text\ncase-1,hello\n'], { type: 'text/csv' });
    const uploadProgress = { loadedBytes: file.size, totalBytes: file.size };
    const client = fakeClient({
      createRawDatasetImport: vi.fn().mockResolvedValue({
        import: { id: 'imp-raw-1' },
        uploadSession: {
          sessionId: 'up-1',
          url: 'https://storage.example/upload',
          expiresAt: new Date().toISOString(),
        },
        maxBytes: 2_147_483_648,
      }),
      uploadRawDatasetFile: vi.fn().mockImplementation(async (_session, _file, options) => {
        options?.onProgress?.(uploadProgress);
      }),
      completeRawDatasetUpload: vi.fn().mockResolvedValue(importStatus('uploaded')),
      completeDatasetImport: vi.fn().mockResolvedValue(importStatus('queued')),
      getDatasetImport: vi.fn().mockResolvedValue(importStatus('completed', { receivedRows: 1 })),
    });
    const onUploadProgress = vi.fn();

    await runRawDatasetImport({
      projectId: PROJECT_ID,
      createBody: {
        ...CREATE_BODY,
        sourceFile: { fileName: 'train.csv', fileSizeBytes: file.size },
        sourceFormat: 'csv',
      },
      file,
      client,
      onUploadProgress,
      pollIntervalMs: 0,
    });

    expect(onUploadProgress).toHaveBeenCalledWith(uploadProgress);
  });

  it('aborts the raw session when direct upload fails', async () => {
    const client = fakeClient({
      createRawDatasetImport: vi.fn().mockResolvedValue({
        import: { id: 'imp-raw-1' },
        uploadSession: {
          sessionId: 'up-1',
          url: 'https://storage.example/upload',
          expiresAt: new Date().toISOString(),
        },
        maxBytes: 2_147_483_648,
      }),
      uploadRawDatasetFile: vi.fn().mockRejectedValue(new Error('upload failed')),
    });

    await expect(
      runRawDatasetImport({
        projectId: PROJECT_ID,
        createBody: CREATE_BODY,
        file: new Blob(['x']),
        client,
      }),
    ).rejects.toThrow('upload failed');

    expect(client.completeDatasetImport).not.toHaveBeenCalled();
    expect(client.completeRawDatasetUpload).not.toHaveBeenCalled();
    expect(client.abortDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-raw-1');
  });

  it('aborts the raw session when the user leaves during server import polling', async () => {
    const controller = new AbortController();
    const client = fakeClient({
      createRawDatasetImport: vi.fn().mockResolvedValue({
        import: { id: 'imp-raw-1' },
        uploadSession: {
          sessionId: 'up-1',
          url: 'https://storage.example/upload',
          expiresAt: new Date().toISOString(),
        },
        maxBytes: 2_147_483_648,
      }),
      uploadRawDatasetFile: vi.fn().mockResolvedValue(undefined),
      completeRawDatasetUpload: vi.fn().mockResolvedValue(importStatus('uploaded')),
      completeDatasetImport: vi.fn().mockResolvedValue(importStatus('queued')),
      getDatasetImport: vi.fn(),
    });

    await expect(
      runRawDatasetImport({
        projectId: PROJECT_ID,
        createBody: CREATE_BODY,
        file: new Blob(['x']),
        signal: controller.signal,
        client,
        onProgress: (event) => {
          if (event.phase === 'queued') controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(client.completeRawDatasetUpload).toHaveBeenCalledWith(PROJECT_ID, 'imp-raw-1');
    expect(client.completeDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-raw-1');
    expect(client.getDatasetImport).not.toHaveBeenCalled();
    expect(client.abortDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-raw-1');
  });
});
