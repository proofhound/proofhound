import { describe, expect, it, vi, type Mocked } from 'vitest';
import { LOCAL_PROJECT_ID, createQuickStartSchema, type CreateProjectModelDto } from '@proofhound/shared';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import type { OptimizationService } from '../../optimization/optimization.service';
import type { DatasetService } from '../../dataset/dataset.service';
import type { ModelService } from '../../model/model.service';
import { QuickStartService } from '../quick-start.service';

const actor: CurrentUserPayload = {
  sub: '00000000-0000-4000-8000-000000000001',
  email: 'ziqixiao@example.com',
  isSuperAdmin: false,
  isActive: true,
};

const draftModel: CreateProjectModelDto = {
  name: 'GPT-4o quick start',
  providerType: 'openai',
  providerModelId: 'gpt-4o-mini',
  endpoint: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  contextWindowTokens: 128000,
  rpm: { limit: 60 },
  tpm: { limit: 100000 },
  concurrency: { limit: 20 },
  autoConcurrency: true,
  pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  capabilities: { image: 'none' },
  extraBody: {},
};

function makeDatasetService(): Mocked<DatasetService> {
  return {
    createDataset: vi.fn().mockResolvedValue({
      dataset: { id: '22222222-2222-4222-8222-000000000002' },
      sampleCount: 1,
    }),
  } as unknown as Mocked<DatasetService>;
}

function makeModelService(): Mocked<ModelService> {
  return {
    listQuickStartModelOptions: vi.fn(),
    probeQuickStartDraftModel: vi.fn(),
    probeQuickStartExistingModel: vi.fn(),
    getQuickStartModelOption: vi.fn(),
    createProjectModel: vi.fn().mockResolvedValue({ id: '33333333-3333-4333-8333-000000000003' }),
  } as unknown as Mocked<ModelService>;
}

function makeOptimizationService(): Mocked<OptimizationService> {
  return {
    createOptimization: vi.fn().mockResolvedValue({
      id: '44444444-4444-4444-8444-000000000004',
      promptId: '55555555-5555-4555-8555-000000000005',
    }),
  } as unknown as Mocked<OptimizationService>;
}

describe('QuickStartService', () => {
  it('creates dataset, model, and dataset-first optimization with quick-start defaults', async () => {
    const datasets = makeDatasetService();
    const models = makeModelService();
    const optimizations = makeOptimizationService();
    const service = new QuickStartService(datasets, models, optimizations);

    const input = createQuickStartSchema.parse({
      projectName: 'Support QA',
      taskDescription: 'Classify support conversations by intent.',
      dataset: {
        name: 'support samples',
        uploadSource: {
          fileName: 'support.csv',
          fileSizeBytes: 128,
          contentType: 'text/csv',
        },
        fieldMappings: [
          { name: 'conversation', role: 'text' },
          { name: 'label', role: 'expected' },
          { name: 'source', role: 'metadata' },
        ],
        samples: [{ conversation: 'refund please', label: 'refund', source: 'seed' }],
      },
      experimentModel: { kind: 'draft', model: draftModel },
      analysisModel: { kind: 'draft', model: draftModel },
    });

    const result = await service.createQuickStart(input, actor);

    expect(result).toEqual({
      projectId: LOCAL_PROJECT_ID,
      datasetId: '22222222-2222-4222-8222-000000000002',
      promptId: '55555555-5555-4555-8555-000000000005',
      optimizationId: '44444444-4444-4444-8444-000000000004',
    });
    expect(datasets.createDataset).toHaveBeenCalledWith(
      LOCAL_PROJECT_ID,
      expect.objectContaining({ name: 'support samples' }),
      actor,
    );
    expect(models.createProjectModel).toHaveBeenCalledTimes(1);
    expect(optimizations.createOptimization).toHaveBeenCalledWith(
      LOCAL_PROJECT_ID,
      expect.objectContaining({
        startingMode: 'from_dataset_only',
        datasetId: '22222222-2222-4222-8222-000000000002',
        experimentModelId: '33333333-3333-4333-8333-000000000003',
        analysisModelId: '33333333-3333-4333-8333-000000000003',
        strategyConfig: { initialSamplingRounds: 3, initialSamplesPerRound: 10 },
        loopLimits: { maxRounds: 3, stopAfterNoImprovementRounds: 0 },
        runConfig: expect.objectContaining({ temperature: 0.3, rpmLimit: 60, tpmLimit: 100000, concurrency: 20 }),
        fieldWhitelist: { inputFields: ['conversation'], metaFields: ['source'] },
      }),
      actor,
      'api',
    );
  });
});
