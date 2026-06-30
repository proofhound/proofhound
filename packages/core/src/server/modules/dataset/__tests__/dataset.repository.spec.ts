import type { DbClient } from '@proofhound/db';
import { DatasetRepository } from '../dataset.repository';

const mockDb = {} as DbClient;

describe('DatasetRepository (DB stub smoke tests)', () => {
  it('can be instantiated without throwing', () => {
    expect(() => new DatasetRepository(mockDb)).not.toThrow();
  });

  it('exposes the expected public methods', () => {
    const repo = new DatasetRepository(mockDb);
    const methods = [
      'findProjectAccess',
      'findDatasetByProjectAndName',
      'listDatasets',
      'findDatasetById',
      'hardDeleteDataset',
      'createDatasetWithSamples',
    ];

    for (const method of methods) {
      expect(typeof (repo as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});
