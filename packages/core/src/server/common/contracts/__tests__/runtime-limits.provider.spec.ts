import { describe, expect, it } from 'vitest';
import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';
import { LocalRuntimeLimitsProvider } from '../runtime-limits.provider';

// OSS default: the provider must not alter the caller's limits (no plan/quota awareness).
describe('LocalRuntimeLimitsProvider', () => {
  const provider = new LocalRuntimeLimitsProvider();

  it('returns the caller limits unchanged', async () => {
    const limits = { concurrency: 4, rpmLimit: 60, tpmLimit: 120_000 };
    await expect(
      provider.mergeLlmLimits({
        project: LOCAL_PROJECT_CONTEXT,
        modelId: 'm-1',
        source: 'experiment',
        limits,
      }),
    ).resolves.toBe(limits);
  });

  it('returns undefined when the caller supplied no limits', async () => {
    await expect(
      provider.mergeLlmLimits({ project: LOCAL_PROJECT_CONTEXT, modelId: 'm-1', source: 'release' }),
    ).resolves.toBeUndefined();
  });
});
