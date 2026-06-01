import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../../actor-context';
import { LimiterKeyStrategy, LocalLimiterKeyStrategy } from '../limiter-key.strategy';

describe('LocalLimiterKeyStrategy', () => {
  const strategy = new LocalLimiterKeyStrategy();

  it('is a LimiterKeyStrategy', () => {
    expect(strategy).toBeInstanceOf(LimiterKeyStrategy);
  });

  it('returns model:<modelId>, ignoring actor/project', () => {
    const script: ActorContext = { actorId: 'tok-1', actorKind: 'script' };
    const localUser: ActorContext = { actorId: 'owner', actorKind: 'local_user' };
    expect(strategy.buildModelKey(script, LOCAL_PROJECT_CONTEXT, 'gpt-x')).toBe('model:gpt-x');
    expect(strategy.buildModelKey(localUser, LOCAL_PROJECT_CONTEXT, 'claude-y')).toBe('model:claude-y');
  });
});
