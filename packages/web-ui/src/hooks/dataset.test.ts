import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  getDatasetDeleteImpactQueryKey,
  getDatasetDetailQueryKey,
  getDatasetListQueryKey,
  getDatasetSamplesQueryKey,
  handleDatasetDeleted,
} from './dataset';

vi.mock('@proofhound/api-client', () => ({
  datasetClient: {},
}));

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DATASET_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DATASET_ID = '33333333-3333-4333-8333-333333333333';

describe('handleDatasetDeleted', () => {
  it('refreshes only the dataset list and clears the deleted dataset cache branch', async () => {
    const queryClient = new QueryClient();
    const listKey = getDatasetListQueryKey(PROJECT_ID);
    const detailKey = getDatasetDetailQueryKey(PROJECT_ID, DATASET_ID);
    const deleteImpactKey = getDatasetDeleteImpactQueryKey(PROJECT_ID, DATASET_ID);
    const samplesKey = getDatasetSamplesQueryKey(PROJECT_ID, DATASET_ID, { page: 1, pageSize: 25, search: '' });
    const otherDeleteImpactKey = getDatasetDeleteImpactQueryKey(PROJECT_ID, OTHER_DATASET_ID);

    queryClient.setQueryData(listKey, { data: [], total: 0 });
    queryClient.setQueryData(detailKey, { id: DATASET_ID });
    queryClient.setQueryData(deleteImpactKey, { experiments: [], optimizations: [] });
    queryClient.setQueryData(samplesKey, { data: [], total: 0 });
    queryClient.setQueryData(otherDeleteImpactKey, { experiments: [{ id: 'exp-1' }], optimizations: [] });

    await handleDatasetDeleted(queryClient, PROJECT_ID, DATASET_ID);

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(detailKey)).toBeUndefined();
    expect(queryClient.getQueryData(deleteImpactKey)).toBeUndefined();
    expect(queryClient.getQueryData(samplesKey)).toBeUndefined();
    expect(queryClient.getQueryData(otherDeleteImpactKey)).toEqual({
      experiments: [{ id: 'exp-1' }],
      optimizations: [],
    });
    expect(queryClient.getQueryState(otherDeleteImpactKey)?.isInvalidated).toBe(false);
  });
});
