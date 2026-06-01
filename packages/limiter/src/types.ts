export interface RateLimitConfig {
  rpmLimit: number;
  tpmLimit: number;
  concurrencyLimit: number;
}

export interface AcquireArgs {
  // Opaque rate-limit key composed by the caller via LimiterKeyStrategy (e.g. `model:<modelId>`).
  // The limiter is unaware of project/actor — it only counts against this key. See SPEC 08 §3.7.
  key: string;
  estimatedTokens: number;
  limits: RateLimitConfig;
  // When true, concurrencyLimit is treated as a ceiling and the effective concurrency
  // is auto-derived (Little's Law + AIMD backoff). See docs/specs/21-models.md §6.1
  autoConcurrency?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

// Auto-concurrency derivation surfaced by a successful acquire (for observability/logging).
export interface AcquireResult {
  effectiveConcurrency: number;
  backoffFactor: number;
  latencyEwmaMs: number;
}

export interface ReleaseArgs {
  key: string;
}

// Feedback signal used to adapt the auto-concurrency state for a model.
export interface ReportOutcomeArgs {
  key: string;
  kind: 'success' | 'upstream_throttle';
  latencyMs?: number; // success only
  tokens?: number; // success only: input + output
}

export interface UsageSnapshot {
  key: string;
  rpmUsed: number;
  tpmUsed: number;
  concurrencyInUse: number;
  windowMs: number;
  windowEndsAt: string;
  // Auto-concurrency observability (present once the model has accumulated autostate).
  backoffFactor?: number;
  latencyEwmaMs?: number;
  tokensEwma?: number;
}

export interface RateLimiter {
  acquire(args: AcquireArgs): Promise<AcquireResult | void>;
  release(args: ReleaseArgs): Promise<void>;
  getUsage?(key: string): Promise<UsageSnapshot>;
  reportOutcome?(args: ReportOutcomeArgs): Promise<void>;
}

export class RateLimitExceededError extends Error {
  readonly reason: 'rpm' | 'tpm' | 'concurrency';
  readonly retryAfterMs: number;

  constructor(reason: 'rpm' | 'tpm' | 'concurrency', retryAfterMs: number) {
    super(`rate limit exceeded: ${reason}`);
    this.name = 'RateLimitExceededError';
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}
