import { describe, expect, it } from 'vitest';
import {
  applyRuntimeConcurrencyCapToModel,
  clampRuntimeConcurrencyInputText,
  runtimeConcurrencyCreateDefaultValue,
} from './model-runtime-limits';
import type { ProjectModel } from './model-view-model';

const baseModel: ProjectModel = {
  id: 'model-1',
  name: 'GPT',
  provider: 'openai',
  providerModelId: 'gpt-4o',
  endpoint: 'https://api.example.test/v1',
  source: 'local',
  status: 'enabled',
  apiKey: '',
  credentialTail: 'abcd',
  contextWindow: '128 k',
  contextWindowInput: '128000',
  extraBodyInput: '',
  rpm: { limit: '120', limitInput: '120', usage: 0, current: '0' },
  tpm: { limit: '300 k', limitInput: '300000', usage: 0, current: '0' },
  concurrency: { limit: '20', limitInput: '20', usage: 10, current: '2', effective: '12' },
  autoConcurrency: true,
  pricing: { inputPerMillion: '1.00', outputPerMillion: '2.00' },
  imageCapability: 'none',
  references: 0,
  readonly: false,
  lastUpdated: '2026-06-23T00:00:00.000Z',
};

describe('applyRuntimeConcurrencyCapToModel', () => {
  it('caps concurrency dashboard fields to the runtime plan limit', () => {
    const model = applyRuntimeConcurrencyCapToModel(baseModel, 3);

    expect(model.concurrency.limit).toBe('3');
    expect(model.concurrency.limitInput).toBe('3');
    expect(model.concurrency.effective).toBe('3');
    expect(model.concurrency.current).toBe('2');
    expect(model.concurrency.usage).toBe(67);
  });

  it('keeps a lower model limit when it is already below the runtime plan limit', () => {
    const model = applyRuntimeConcurrencyCapToModel(
      {
        ...baseModel,
        concurrency: { ...baseModel.concurrency, limit: '2', limitInput: '2', current: '1', effective: '2' },
      },
      3,
    );

    expect(model.concurrency.limit).toBe('2');
    expect(model.concurrency.limitInput).toBe('2');
    expect(model.concurrency.effective).toBe('2');
    expect(model.concurrency.usage).toBe(50);
  });

  it('returns the original model when there is no runtime plan cap', () => {
    expect(applyRuntimeConcurrencyCapToModel(baseModel, null)).toBe(baseModel);
  });
});

describe('clampRuntimeConcurrencyInputText', () => {
  it('clamps typed values above the runtime plan cap', () => {
    expect(clampRuntimeConcurrencyInputText('999', 3)).toBe('3');
  });

  it('keeps empty and in-range input text editable', () => {
    expect(clampRuntimeConcurrencyInputText('', 3)).toBe('');
    expect(clampRuntimeConcurrencyInputText('2', 3)).toBe('2');
  });

  it('does not clamp when the runtime plan cap is absent', () => {
    expect(clampRuntimeConcurrencyInputText('999', null)).toBe('999');
  });
});

describe('runtimeConcurrencyCreateDefaultValue', () => {
  it('uses the runtime plan cap as the new-model default when present', () => {
    expect(runtimeConcurrencyCreateDefaultValue(3)).toBe('3');
  });

  it('leaves OSS/local new-model defaults blank when no runtime plan cap exists', () => {
    expect(runtimeConcurrencyCreateDefaultValue(null)).toBeUndefined();
  });
});
