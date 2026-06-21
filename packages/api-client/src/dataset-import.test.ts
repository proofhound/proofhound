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
