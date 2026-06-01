import type { DatasetImportClient } from '@proofhound/api-client';
import type { CreateDatasetImportDto } from '@proofhound/shared';
import { describe, expect, it, vi } from 'vitest';
import { runDatasetImport, type DatasetImportProgress } from '../dataset-import-runner';

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
    ...overrides,
  } as unknown as DatasetImportClient;
}

async function* batchesOf(...batches: Array<Array<Record<string, unknown>>>) {
  for (const batch of batches) yield batch;
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
});
