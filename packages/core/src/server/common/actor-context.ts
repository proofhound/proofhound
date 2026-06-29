// ActorKind — see docs/specs/08-adapter-extension-points.md §3.2 / §3.3 / §3.4
//
// Each value maps to a single entry channel; OSS does NOT mix channels:
//   - 'script':         HTTP API channel, Authorization: Bearer ph_*; actorId = user-token row id
//   - 'local_user':     HTTP UI channel; OSS deployment formation A (LOCAL_ACTOR fallback) or B
//                       (trusted-header), actorId = LOCAL_ACTOR_ID; a replacement RemoteActorContextResolver
//                       overrides to use Supabase JWT sub as actorId
//   - 'system_mcp':     MCP channel; actorId = user-token row id (OSS) or org-mcp-token id (override implementation)
//   - 'system_webhook': Webhook channel; actorId = connectorId
//   - 'system_release_runner': Internal release runner tick; actorId = release line id
//   - 'system_workflow_recovery': Internal DBOS recovery tick; actorId = workflow business row id
export type ActorKind =
  | 'script'
  | 'local_user'
  | 'system_mcp'
  | 'system_webhook'
  | 'system_release_runner'
  | 'system_workflow_recovery';

export interface ActorContext {
  actorId: string;
  actorKind: ActorKind;
  projectId?: string;
  /** override-only: the org this actor is pinned to (e.g. an org-scoped API token). OSS never sets it. */
  orgId?: string;
}

// Stable UUID used as the synthetic local-user actor in OSS self-hosted deployments.
// Lives here (not in guard.ts) so the resolver and other low-level layers can import it
// without taking a reverse dependency on the guard.
export const LOCAL_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

export type { ProjectContext } from '@proofhound/shared';
