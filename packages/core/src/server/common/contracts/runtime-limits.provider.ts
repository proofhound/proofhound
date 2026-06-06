// RuntimeLimitsProvider — adapter extension point
// See docs/specs/08-saas-adapter-boundary.md §3.10
//
// Lets a deployment fold deployment-level runtime caps into a call's per-call RPM/TPM/concurrency
// limits before enqueueing or direct invocation — e.g. a SaaS org plan's concurrency ceiling. It carries NO billing
// semantics: it only translates an already-resolved ProjectContext (+ model / source) into an optional
// limits override. The OSS default `LocalRuntimeLimitsProvider` is a genuine pass-through (returns the
// caller's limits unchanged) and is invoked before every LLM enqueue/direct call, so OSS behavior is identical.
// Mirrors LimiterKeyStrategy: abstract class as DI token + Local* default implementation.

import type { RuntimeLimits } from '@proofhound/orchestration-shared';
import type { ProjectContext } from '../actor-context';

export interface RuntimeLimitsInput {
  project: ProjectContext;
  modelId: string;
  /** The LLM job source (`experiment` / `optimization_*` / `release`) or a probe / synchronous caller tag. */
  source: string;
  /** The per-call limits the caller already derived (e.g. from runConfig); may be undefined. */
  limits?: RuntimeLimits;
}

export abstract class RuntimeLimitsProvider {
  abstract mergeLlmLimits(input: RuntimeLimitsInput): Promise<RuntimeLimits | undefined>;
}

export class LocalRuntimeLimitsProvider extends RuntimeLimitsProvider {
  // OSS knows nothing about plans/quotas: return the caller's limits verbatim.
  async mergeLlmLimits(input: RuntimeLimitsInput): Promise<RuntimeLimits | undefined> {
    return input.limits;
  }
}
