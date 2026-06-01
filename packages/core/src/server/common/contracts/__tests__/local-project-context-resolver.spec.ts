import { describe, expect, it } from 'vitest';
import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';
import { LocalProjectContextResolver } from '../local-project-context.resolver';
import type { ActorContext } from '../../actor-context';

describe('LocalProjectContextResolver', () => {
  const actor: ActorContext = { actorId: 'a', actorKind: 'script' };

  it('忽略 hint，固定返回 LOCAL_PROJECT_CONTEXT', async () => {
    const resolver = new LocalProjectContextResolver();
    await expect(resolver.resolve(actor)).resolves.toBe(LOCAL_PROJECT_CONTEXT);
    await expect(resolver.resolve(actor, { projectIdHeader: 'other-project' })).resolves.toBe(
      LOCAL_PROJECT_CONTEXT,
    );
    await expect(resolver.resolve(actor, { connectorId: 'c-1' })).resolves.toBe(LOCAL_PROJECT_CONTEXT);
  });
});
