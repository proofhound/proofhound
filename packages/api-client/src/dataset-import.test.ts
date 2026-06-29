import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DatasetUploadMetadataDto } from '@proofhound/shared';
import { datasetImportClient } from './dataset-import';
import { httpClient } from './http';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

const METADATA: DatasetUploadMetadataDto = {
  name: 'regression-set',
  description: null,
  fieldMappings: [
    { name: 'id', role: 'id' },
    { name: 'text', role: 'text' },
  ],
  sourceFormat: 'csv',
  fileName: 'train.csv',
};

describe('datasetImportClient.uploadDataset', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs the file and metadata as multipart and returns the completed import status', async () => {
    const status = { id: 'imp-1', state: 'completed', datasetId: 'ds-1' };
    const post = vi.spyOn(httpClient, 'post').mockResolvedValue({ data: status } as never);

    const file = new Blob(['id,text\n1,hello\n'], { type: 'text/csv' });
    const result = await datasetImportClient.uploadDataset(PROJECT_ID, file, METADATA);

    expect(result).toBe(status);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0] ?? [];
    expect(url).toBe('/datasets/upload');
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get('name')).toBe('regression-set');
    expect(form.get('sourceFormat')).toBe('csv');
    expect(form.get('fieldMappings')).toBe(JSON.stringify(METADATA.fieldMappings));
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('reports upload progress through onUploadProgress, falling back to the file size for total', async () => {
    const post = vi.spyOn(httpClient, 'post').mockImplementation((_url, _body, config) => {
      config?.onUploadProgress?.({ loaded: 4, total: undefined } as never);
      return Promise.resolve({ data: { id: 'imp-1', state: 'completed' } } as never);
    });

    const file = new Blob(['id,text\n1,hi\n'], { type: 'text/csv' });
    const onProgress = vi.fn();
    await datasetImportClient.uploadDataset(PROJECT_ID, file, METADATA, { onProgress });

    expect(post).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({ loadedBytes: 4, totalBytes: file.size });
  });
});
