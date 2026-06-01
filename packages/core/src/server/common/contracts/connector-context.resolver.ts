// ConnectorContextResolver — adapter extension point
// See docs/specs/08-saas-adapter-boundary.md §3.4
//
// Resolves `(:webhookSlug, :pathName) + webhook token` into a connector context, then produces a
// ProjectContext + a system actor in one shot. The webhook entry does NOT go through
// ProjectContextResolver (§3.1): a webhook credential is a per-consumer channel credential, not the
// project administrator, so this resolver produces the ProjectContext directly.
//
// Independent of ActorContextResolver (§3.2) / McpAuthResolver (§3.3) — the three entry resolvers
// never call each other (§8 red line).
//
// OSS default `LocalConnectorContextResolver` lives in the webhook runtime (it depends on
// WebhookRepository); SaaS `RemoteConnectorContextResolver` may add HMAC / multi-tenant isolation.
//
// `ConnectorRecord` is defined structurally here so this abstract stays free of any webhook-runtime
// import (keeping the dependency acyclic); the webhook runtime's connector row satisfies it.

import type { ActorContext, ProjectContext } from '../actor-context';

export interface ConnectorRecord {
  id: string;
  projectId: string;
  name: string;
  config: Record<string, unknown>;
  webhookPath: string | null;
  ipWhitelist: string[] | null;
}

export interface ConnectorResolveResult {
  connector: ConnectorRecord;
  projectContext: ProjectContext;
  actorContext: ActorContext; // actorKind='system_webhook', actorId=connectorId
  webhookTokenId: string; // surfaced for run-result attribution (ph_runs.run_results.webhook_token_id)
}

export abstract class ConnectorContextResolver {
  abstract resolveFromWebhookToken(
    webhookSlug: string,
    pathName: string,
    token: string,
  ): Promise<ConnectorResolveResult>;
}
