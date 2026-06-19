import type { DbClient } from '@proofhound/db';
import { ObjectStorageProvider } from '../../../common/contracts/object-storage.provider';
import { DatasetSamplePayloadReader } from '../dataset-sample-payload';
import { DatasetRepository } from '../dataset.repository';

const mockDb = {} as DbClient;
const disabledStorage = { isEnabled: () => false } as unknown as ObjectStorageProvider;
const sampleReader = new DatasetSamplePayloadReader(disabledStorage);

describe('DatasetRepository (DB stub smoke tests)', () => {
  it('can be instantiated without throwing', () => {
    expect(() => new DatasetRepository(mockDb, sampleReader, disabledStorage)).not.toThrow();
  });

  it('exposes the expected public methods', () => {
    const repo = new DatasetRepository(mockDb, sampleReader, disabledStorage);
    const methods = [
      'findProjectAccess',
      'findDatasetByProjectAndName',
      'listDatasets',
      'findDatasetById',
      'listDatasetSamples',
      'hardDeleteDataset',
      'createDatasetWithSamples',
    ];

    for (const method of methods) {
      expect(typeof (repo as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});
