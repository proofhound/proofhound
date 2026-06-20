import { afterEach, describe, expect, it, vi } from 'vitest';

import { datasetImportClient } from './dataset-import';

const IMPORT_ID = '00000000-0000-4000-8000-000000000100';

describe('datasetImportClient.abortDatasetImportBeacon', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns false when sendBeacon is unavailable', () => {
    vi.stubGlobal('navigator', {});

    expect(datasetImportClient.abortDatasetImportBeacon('p', IMPORT_ID)).toBe(false);
  });

  it('posts the abort URL via sendBeacon and returns its result', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://api.example.test');
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon });

    const result = datasetImportClient.abortDatasetImportBeacon('p', IMPORT_ID);

    expect(result).toBe(true);
    expect(sendBeacon).toHaveBeenCalledWith(`https://api.example.test/dataset-imports/${IMPORT_ID}/abort`);
  });
});

describe('datasetImportClient.uploadRawDatasetFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts the raw file bytes to the provider upload URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const file = new Blob(['a,b\n1,2\n'], { type: 'text/csv' });

    await datasetImportClient.uploadRawDatasetFile(
      {
        sessionId: 'upload-1',
        url: 'https://storage.example/upload',
        headers: { 'content-type': 'text/csv' },
        expiresAt: '2026-06-20T00:00:00.000Z',
      },
      file,
    );

    expect(fetchMock).toHaveBeenCalledWith('https://storage.example/upload', {
      method: 'PUT',
      headers: { 'content-type': 'text/csv' },
      body: file,
      signal: undefined,
    });
  });
});
