import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../../actor-context';
import { LocalWorkflowAuthorizationHook, WorkflowAuthorizationHook } from '../workflow-authorization.hook';

describe('LocalWorkflowAuthorizationHook', () => {
  const hook = new LocalWorkflowAuthorizationHook();

  it('is a WorkflowAuthorizationHook', () => {
    expect(hook).toBeInstanceOf(WorkflowAuthorizationHook);
  });

  it('passes (no-op) for any actor and workflow kind', async () => {
    const actors: ActorContext[] = [
      { actorId: 'tok-1', actorKind: 'script' },
      { actorId: 'conn-1', actorKind: 'system_webhook' },
    ];
    for (const actor of actors) {
      await expect(hook.assertCanStart(actor, LOCAL_PROJECT_CONTEXT, 'experiment')).resolves.toBeUndefined();
      await expect(hook.assertCanStart(actor, LOCAL_PROJECT_CONTEXT, 'llm')).resolves.toBeUndefined();
    }
  });
});
