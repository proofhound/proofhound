import { describe, expect, it } from 'vitest';
import { capConcurrencyValue, resolveEffectiveConcurrencyLimit } from './runtime-limits-provider';

describe('runtime limits UI helpers', () => {
  it('uses the lower of the model concurrency limit and the plan concurrency cap', () => {
    expect(resolveEffectiveConcurrencyLimit(20, { concurrency: { max: 3 } })).toBe(3);
    expect(resolveEffectiveConcurrencyLimit(2, { concurrency: { max: 3 } })).toBe(2);
    expect(resolveEffectiveConcurrencyLimit(20, {})).toBe(20);
    expect(resolveEffectiveConcurrencyLimit(null, { concurrency: { max: 50 } })).toBe(50);
  });

  it('caps submitted concurrency values while preserving uncapped OSS behavior', () => {
    expect(capConcurrencyValue(20, 3)).toBe(3);
    expect(capConcurrencyValue(2, 3)).toBe(2);
    expect(capConcurrencyValue(20, null)).toBe(20);
  });
});
