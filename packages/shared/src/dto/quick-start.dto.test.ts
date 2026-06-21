import { describe, expect, it } from 'vitest';
import {
  QUICK_START_DEFAULT_INITIAL_SAMPLES_PER_ROUND,
  QUICK_START_DEFAULT_INITIAL_SAMPLING_ROUNDS,
  QUICK_START_DEFAULT_MAX_ROUNDS,
  createQuickStartSchema,
} from './quick-start.dto';

const draftModel = {
  name: 'GPT-4o quick start',
  providerType: 'openai',
  providerModelId: 'gpt-4o-mini',
  endpoint: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  contextWindowTokens: 128000,
  rpm: { limit: 60 },
  tpm: { limit: 100000 },
  concurrency: { limit: 20 },
  pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  capabilities: { image: 'none' as const },
  extraBody: {},
};

const baseInput = {
  projectName: 'Quick start',
  taskDescription: 'Classify support conversations by intent.',
  dataset: {
    name: 'support samples',
    uploadSource: {
      fileName: 'support.csv',
      fileSizeBytes: 128,
      contentType: 'text/csv',
    },
    fieldMappings: [
      { name: 'conversation', role: 'text' as const },
      { name: 'label', role: 'expected' as const },
      { name: 'source', role: 'metadata' as const },
    ],
    samples: [{ conversation: 'refund please', label: 'refund', source: 'seed' }],
  },
  experimentModel: { kind: 'draft' as const, model: draftModel },
  analysisModel: { kind: 'draft' as const, model: draftModel },
};

describe('createQuickStartSchema', () => {
  it('applies quick-start defaults that do not depend on model limits', () => {
    const parsed = createQuickStartSchema.parse(baseInput);

    expect(parsed.loopLimits).toEqual({
      maxRounds: QUICK_START_DEFAULT_MAX_ROUNDS,
      stopAfterNoImprovementRounds: 0,
    });
    expect(parsed.strategyConfig).toEqual({
      initialSamplingRounds: QUICK_START_DEFAULT_INITIAL_SAMPLING_ROUNDS,
      initialSamplesPerRound: QUICK_START_DEFAULT_INITIAL_SAMPLES_PER_ROUND,
    });
    expect(parsed.runConfig).toBeUndefined();
    expect(parsed.goals[0]).toEqual({ metric: 'accuracy', comparator: 'gte', target: 0.8, scope: 'overall' });
  });

  it('requires exactly one expected field and at least one input field', () => {
    expect(
      createQuickStartSchema.safeParse({
        ...baseInput,
        dataset: {
          ...baseInput.dataset,
          fieldMappings: [
            { name: 'conversation', role: 'text' },
            { name: 'label', role: 'metadata' },
          ],
        },
      }).success,
    ).toBe(false);

    expect(
      createQuickStartSchema.safeParse({
        ...baseInput,
        dataset: {
          ...baseInput.dataset,
          fieldMappings: [
            { name: 'conversation', role: 'metadata' },
            { name: 'label', role: 'expected' },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('accepts an imported dataset reference for the web import-session flow', () => {
    const parsed = createQuickStartSchema.parse({
      ...baseInput,
      dataset: {
        kind: 'imported',
        datasetId: '11111111-1111-4111-8111-111111111111',
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
      },
    });

    expect(parsed.dataset).toEqual(
      expect.objectContaining({
        kind: 'imported',
        datasetId: '11111111-1111-4111-8111-111111111111',
      }),
    );
  });
});
