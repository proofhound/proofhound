import type { DbClient } from '@proofhound/db';
import { InlineDatasetSamplePayloadReader } from '../dataset-sample-payload';
import { DatasetRepository } from '../dataset.repository';

const mockDb = {} as DbClient;
const sampleReader = new InlineDatasetSamplePayloadReader();

describe('DatasetRepository (DB stub smoke tests)', () => {
  it('can be instantiated without throwing', () => {
    expect(() => new DatasetRepository(mockDb, sampleReader)).not.toThrow();
  });

  it('exposes the expected public methods', () => {
    const repo = new DatasetRepository(mockDb, sampleReader);
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
