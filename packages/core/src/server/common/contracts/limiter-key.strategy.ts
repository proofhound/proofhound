// LimiterKeyStrategy — adapter extension point
// See docs/specs/08-saas-adapter-boundary.md §3.7
//
// Generates the rate-limit key for a model call. The core server / worker runtimes build the key via
// this strategy and pass it down as an OPAQUE string; `@proofhound/limiter` and `@proofhound/llm-client`
// never learn the actor / project (§8 red line) — they only see the composed key.
//
// OSS default `LocalLimiterKeyStrategy` returns `model:<modelId>` (the counting space is per-model).
// SaaS may return `org:<orgId>:model:<modelId>` or a finer-grained key to isolate the counting space
// per tenant — the contract stays unchanged.

import type { ActorContext, ProjectContext } from '../actor-context';

export abstract class LimiterKeyStrategy {
  abstract buildModelKey(actor: ActorContext, project: ProjectContext, modelId: string): string;
}

export class LocalLimiterKeyStrategy extends LimiterKeyStrategy {
  buildModelKey(_actor: ActorContext, _project: ProjectContext, modelId: string): string {
    return `model:${modelId}`;
  }
}
