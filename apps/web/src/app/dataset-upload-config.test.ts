import { describe, expect, it } from 'vitest';
import { DATASET_UPLOAD_MAX_BYTES } from '@proofhound/shared';
import { resolveDatasetUploadMaxBytes } from './dataset-upload-config';

describe('resolveDatasetUploadMaxBytes', () => {
  it('uses the shared OSS default when the environment is unset', () => {
    expect(resolveDatasetUploadMaxBytes({})).toBe(DATASET_UPLOAD_MAX_BYTES);
  });

  it('uses the positive integer floor from DATASET_UPLOAD_MAX_BYTES', () => {
    expect(resolveDatasetUploadMaxBytes({ DATASET_UPLOAD_MAX_BYTES: '94371840.9' })).toBe(94_371_840);
  });

  it('falls back to the shared default for invalid values', () => {
    expect(resolveDatasetUploadMaxBytes({ DATASET_UPLOAD_MAX_BYTES: '0' })).toBe(DATASET_UPLOAD_MAX_BYTES);
    expect(resolveDatasetUploadMaxBytes({ DATASET_UPLOAD_MAX_BYTES: 'nope' })).toBe(DATASET_UPLOAD_MAX_BYTES);
  });
});
