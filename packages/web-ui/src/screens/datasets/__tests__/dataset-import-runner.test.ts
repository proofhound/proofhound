import type { DatasetImportClient } from '@proofhound/api-client';
import type { CreateDatasetImportDto } from '@proofhound/shared';
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
    completeDatasetImport: vi.fn().mockResolvedValue({ dataset: { id: 'ds-1' }, sampleCount: 3 }),
    abortDatasetImport: vi.fn().mockResolvedValue(undefined),
    getRawImportCapabilities: vi.fn(),
    createRawDatasetImport: vi.fn(),
    uploadRawDatasetFile: vi.fn(),
    ...overrides,
  } as unknown as DatasetImportClient;
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
    expect(result).toEqual({ dataset: { id: 'ds-1' }, sampleCount: 3 });
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
    });
    const onUploaded = vi.fn();

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
    });

    expect(client.createRawDatasetImport).toHaveBeenCalled();
    expect(client.uploadRawDatasetFile).toHaveBeenCalledWith(
      { sessionId: 'up-1', url: 'https://storage.example/upload', expiresAt: expect.any(String) },
      file,
      { signal: undefined },
    );
    expect(client.completeDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-raw-1');
    expect(client.abortDatasetImport).not.toHaveBeenCalled();
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ dataset: { id: 'ds-1' }, sampleCount: 3 });
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
    expect(client.abortDatasetImport).toHaveBeenCalledWith(PROJECT_ID, 'imp-raw-1');
  });
});
