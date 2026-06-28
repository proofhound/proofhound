import { describe, expect, it } from 'vitest';
import { resolvePromoteOffloadConcurrency } from '../dataset-import.repository';

describe('resolvePromoteOffloadConcurrency', () => {
  it('keeps shard offload sequential by default', () => {
    expect(resolvePromoteOffloadConcurrency({})).toBe(1);
    expect(resolvePromoteOffloadConcurrency({ DATASET_PROMOTE_STORAGE_CONCURRENCY: '' })).toBe(1);
    expect(resolvePromoteOffloadConcurrency({ DATASET_PROMOTE_STORAGE_CONCURRENCY: '0' })).toBe(1);
    expect(resolvePromoteOffloadConcurrency({ DATASET_PROMOTE_STORAGE_CONCURRENCY: 'abc' })).toBe(1);
  });

  it('uses a positive integer from DATASET_PROMOTE_STORAGE_CONCURRENCY', () => {
    expect(resolvePromoteOffloadConcurrency({ DATASET_PROMOTE_STORAGE_CONCURRENCY: '4' })).toBe(4);
    expect(resolvePromoteOffloadConcurrency({ DATASET_PROMOTE_STORAGE_CONCURRENCY: '8' })).toBe(8);
  });

  it('keeps DATASET_IMPORT_OFFLOAD_CONCURRENCY as a compatibility fallback', () => {
    expect(resolvePromoteOffloadConcurrency({ DATASET_IMPORT_OFFLOAD_CONCURRENCY: '8' })).toBe(8);
    expect(
      resolvePromoteOffloadConcurrency({
        DATASET_PROMOTE_STORAGE_CONCURRENCY: '4',
        DATASET_IMPORT_OFFLOAD_CONCURRENCY: '8',
      }),
    ).toBe(4);
  });

  it('caps accidental over-configuration', () => {
    expect(resolvePromoteOffloadConcurrency({ DATASET_PROMOTE_STORAGE_CONCURRENCY: '999' })).toBe(16);
  });
});
