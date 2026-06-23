import { describe, expect, it } from 'vitest';
import type { ModelPreset } from '@proofhound/shared';
import { modelPresetToQuickFillDraft } from './model-preset-draft';

describe('modelPresetToQuickFillDraft', () => {
  it('maps a provider preset into form-ready quick fill values', () => {
    const preset: ModelPreset = {
      key: 'openai:test',
      group: 'openai',
      name: 'OpenAI Test',
      providerType: 'openai',
      providerLabel: 'OpenAI',
      providerModelId: 'gpt-test',
      endpoint: 'https://api.openai.com/v1',
      contextWindowTokens: 128_000,
      rpmLimit: 500,
      tpmLimit: 500_000,
      concurrencyLimit: 20,
      inputTokenPricePerMillion: 1.25,
      outputTokenPricePerMillion: 5,
      capabilities: { image: 'both' },
      extraBody: { reasoning_effort: 'low' },
      featured: true,
    };

    expect(modelPresetToQuickFillDraft(preset)).toEqual({
      key: 'openai:test',
      name: 'OpenAI Test',
      providerType: 'openai',
      providerLabel: 'OpenAI',
      providerModelId: 'gpt-test',
      endpoint: 'https://api.openai.com/v1',
      contextWindowTokens: 128_000,
      rpmLimit: 500,
      tpmLimit: 500_000,
      concurrencyLimit: 20,
      inputTokenPricePerMillion: 1.25,
      outputTokenPricePerMillion: 5,
      imageCapability: 'both',
      extraBodyInput: JSON.stringify({ reasoning_effort: 'low' }, null, 2),
    });
  });

  it('keeps extra body empty when the preset has no provider-specific body', () => {
    const preset: ModelPreset = {
      key: 'qwen:test',
      group: 'qwen',
      name: 'Qwen Test',
      providerType: 'openai',
      providerLabel: 'Qwen / DashScope',
      providerModelId: 'qwen-test',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      contextWindowTokens: 1_000_000,
      rpmLimit: 30_000,
      tpmLimit: 10_000_000,
      concurrencyLimit: 20,
      inputTokenPricePerMillion: 0.17,
      outputTokenPricePerMillion: 1.03,
      capabilities: { image: 'none' },
    };

    expect(modelPresetToQuickFillDraft(preset).extraBodyInput).toBe('');
  });
});
