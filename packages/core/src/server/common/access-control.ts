import type { ActorContext } from './actor-context';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

export type AccessAction =
  | 'project_read'
  | 'project_write'
  | 'release_manage'
  | 'platform_manage'
  | 'user_token_manage'
  | 'mcp_tool';

// Normalize the HTTP CurrentUserPayload (or an already-resolved ActorContext) into a plain ActorContext.
// Call sites pass the result into AccessControlService.assertCan, whose contract takes ActorContext
// (the clean cross-channel identity, not the OSS-specific HTTP payload).
export function toActorContext(actor: CurrentUserPayload | ActorContext): ActorContext {
  const maybeContext = actor as Partial<ActorContext>;
  if (maybeContext.actorId && maybeContext.actorKind) {
    return {
      actorId: maybeContext.actorId,
      actorKind: maybeContext.actorKind,
      projectId: maybeContext.projectId,
    };
  }
  const current = actor as CurrentUserPayload;
  return {
    actorId: current.sub,
    actorKind: current.actorKind ?? 'local_user',
    projectId: current.projectId,
  };
}
