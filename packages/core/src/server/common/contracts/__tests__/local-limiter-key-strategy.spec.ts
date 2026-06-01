import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';
import { describe, expect, it } from 'vitest';
import { LimiterKeyStrategy, LocalLimiterKeyStrategy } from '../limiter-key.strategy';

describe('LocalLimiterKeyStrategy', () => {
  const strategy = new LocalLimiterKeyStrategy();

  it('is a LimiterKeyStrategy', () => {
    expect(strategy).toBeInstanceOf(LimiterKeyStrategy);
  });

  it('returns model:<modelId>, ignoring project', () => {
    expect(strategy.buildModelKey(LOCAL_PROJECT_CONTEXT, 'gpt-x')).toBe('model:gpt-x');
    expect(strategy.buildModelKey({ projectId: 'p-2', source: 'local' }, 'claude-y')).toBe('model:claude-y');
  });
});
