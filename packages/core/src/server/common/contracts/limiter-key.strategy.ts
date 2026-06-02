// LimiterKeyStrategy — adapter extension point
// See docs/specs/08-saas-adapter-boundary.md §3.7
//
// Generates the rate-limit key for a model call. Runtime LLM/probe callers build the key via this
// strategy and pass it down as an OPAQUE string; `@proofhound/limiter` and
// `@proofhound/llm-client` never learn the project (§8 red line) — they only see the composed key.
//
// Keyed by (project, modelId): actor is intentionally NOT part of the key. OSS default
// `LocalLimiterKeyStrategy` returns `model:<modelId>` (per-model counting space, ignoring project).
// SaaS may return `org:<orgId>:model:<modelId>` (deriving org from the project) to isolate the
// counting space per tenant.

import type { ProjectContext } from '../actor-context';

export abstract class LimiterKeyStrategy {
  abstract buildModelKey(project: ProjectContext, modelId: string): string;
}

export class LocalLimiterKeyStrategy extends LimiterKeyStrategy {
  buildModelKey(_project: ProjectContext, modelId: string): string {
    return `model:${modelId}`;
  }
}
