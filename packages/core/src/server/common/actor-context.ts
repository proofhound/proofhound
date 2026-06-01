// ActorKind — see docs/specs/08-saas-adapter-boundary.md §3.2 / §3.3 / §3.4
//
// Each value maps to a single entry channel; OSS does NOT mix channels:
//   - 'script':         HTTP API channel, Authorization: Bearer ph_*; actorId = user-token row id
//   - 'local_user':     HTTP UI channel; OSS deployment formation A (LOCAL_ACTOR fallback) or B
//                       (trusted-header), actorId = LOCAL_ACTOR_ID; SaaS RemoteActorContextResolver
//                       overrides to use Supabase JWT sub as actorId
//   - 'system_mcp':     MCP channel; actorId = user-token row id (OSS) or org-mcp-token id (SaaS)
//   - 'system_webhook': Webhook channel; actorId = connectorId
export type ActorKind = 'script' | 'local_user' | 'system_mcp' | 'system_webhook';

export interface ActorContext {
  actorId: string;
  actorKind: ActorKind;
  projectId?: string;
}

// Stable UUID used as the synthetic local-user actor in OSS self-hosted deployments.
// Lives here (not in guard.ts) so the resolver and other low-level layers can import it
// without taking a reverse dependency on the guard.
export const LOCAL_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

export type { ProjectContext } from '@proofhound/shared';
