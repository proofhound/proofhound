import type { ModelInvocationConfig } from '@proofhound/llm-client';
import { describe, expect, it } from 'vitest';
import { applyRuntimeLimits } from '../runtime-limits';

const baseModel: ModelInvocationConfig = {
  id: 'model-1',
  providerType: 'openai',
  providerModelId: 'gpt-test',
  endpoint: 'https://llm.example.test/v1',
  apiKey: 'test-key',
  capabilities: { image: 'none' },
  rpmLimit: 60,
  tpmLimit: 10_000,
  concurrencyLimit: 4,
  autoConcurrency: true,
  inputTokenPricePerMillion: 0,
  outputTokenPricePerMillion: 0,
};

describe('applyRuntimeLimits', () => {
  it('uses a positive runtime rpm cap when the model rpm is unlimited', () => {
    const effective = applyRuntimeLimits({ ...baseModel, rpmLimit: -1 }, { rpmLimit: 100 });

    expect(effective.rpmLimit).toBe(100);
  });

  it('uses a positive runtime tpm cap when the model tpm is unlimited', () => {
    const effective = applyRuntimeLimits({ ...baseModel, tpmLimit: -1 }, { tpmLimit: 10_000 });

    expect(effective.tpmLimit).toBe(10_000);
  });

  it('keeps the lower model rpm when the runtime rpm cap is higher', () => {
    const effective = applyRuntimeLimits({ ...baseModel, rpmLimit: 60 }, { rpmLimit: 100 });

    expect(effective.rpmLimit).toBe(60);
  });

  it('leaves the model limits unchanged when runtime limits are not provided', () => {
    expect(applyRuntimeLimits(baseModel, undefined)).toEqual(baseModel);
  });

  it('keeps concurrency as the lower positive value', () => {
    const effective = applyRuntimeLimits({ ...baseModel, concurrencyLimit: 4 }, { concurrency: 2 });

    expect(effective.concurrencyLimit).toBe(2);
  });
});
