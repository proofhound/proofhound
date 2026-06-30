import { describe, expect, it, vi } from 'vitest';
import { DatasetSampleRepository } from '../dataset-sample.repository.contract';
import { LocalDatasetSampleRepository } from '../local-dataset-sample.repository';

describe('LocalDatasetSampleRepository', () => {
  it('is bound to the DatasetSampleRepository contract (08 §3.14)', () => {
    const repo = new LocalDatasetSampleRepository({} as never);
    expect(repo).toBeInstanceOf(DatasetSampleRepository);
  });

  it('readSamplesByIds short-circuits empty input without touching the db', async () => {
    const select = vi.fn();
    const repo = new LocalDatasetSampleRepository({ select } as never);
    await expect(repo.readSamplesByIds([])).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});
