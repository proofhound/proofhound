import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import {
  RateLimitExceededError,
  type AcquireArgs,
  type AcquireResult,
  type RateLimiter,
  type ReleaseArgs,
  type ReportOutcomeArgs,
  type UsageSnapshot,
} from './types';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
// concurrency key self-healing window: if no new acquire happens after a process crashes for longer than this, the slot is automatically reset to zero
// Aligned with the LLM job timeout in SPEC 03 §4.3 (5 min)
const DEFAULT_CONCURRENCY_TTL_MS = 5 * 60_000;

// Auto-concurrency tuning (see docs/specs/21-models.md §6.1)
const DEFAULT_AUTOSTATE_TTL_MS = 30 * 60_000;
const DEFAULT_LATENCY_EWMA_MS = 3000;
const DEFAULT_EWMA_ALPHA = 0.3;
const DEFAULT_BACKOFF_MULT = 0.5;
const DEFAULT_BACKOFF_FLOOR = 0.1;
const DEFAULT_BACKOFF_RECOVER_STEP = 0.05;

// Effective concurrency = (RPM/TPM-implied req/s) × latency  (Little's Law), scaled by AIMD backoff,
// clamped to [1, ceiling]. This MUST mirror the Lua `compute_effective` below — parity is unit-tested.
export function deriveEffectiveConcurrency(params: {
  rpmLimit: number;
  tpmLimit: number;
  ceiling: number;
  latencyEwmaMs: number;
  tokensEwma: number;
  backoffFactor: number;
}): number {
  const { rpmLimit, tpmLimit, ceiling, latencyEwmaMs, tokensEwma, backoffFactor } = params;
  const BIG = 1e15;
  const latencyS = latencyEwmaMs / 1000;
  const safeTokens = tokensEwma > 0 ? tokensEwma : 1;
  const rpsRpm = rpmLimit > 0 ? rpmLimit / 60 : BIG;
  const rpsTpm = tpmLimit > 0 ? tpmLimit / safeTokens / 60 : BIG;
  const rpsBudget = Math.min(rpsRpm, rpsTpm);
  const target = rpsBudget >= BIG ? ceiling : Math.ceil(rpsBudget * latencyS);
  let effective = Math.round(target * backoffFactor);
  if (effective < 1) effective = 1;
  if (effective > ceiling) effective = ceiling;
  return effective;
}

const SLIDING_WINDOW_HELPERS = `
local function member_tokens(member)
  local raw = string.match(member, ':(%d+)$')
  return tonumber(raw or '0') or 0
end

local function sum_tpm_members(tpm_key)
  local members = redis.call('ZRANGE', tpm_key, 0, -1)
  local total = 0
  for _, member in ipairs(members) do
    total = total + member_tokens(member)
  end
  return total
end

local function prune_rpm(rpm_key, cutoff_ms)
  redis.call('ZREMRANGEBYSCORE', rpm_key, '-inf', cutoff_ms)
  local count = tonumber(redis.call('ZCARD', rpm_key) or '0')
  if count == 0 then
    redis.call('DEL', rpm_key)
  end
  return count
end

local function prune_tpm(tpm_key, tpm_total_key, cutoff_ms, ttl_ms)
  local expired = redis.call('ZRANGEBYSCORE', tpm_key, '-inf', cutoff_ms)
  local expired_tokens = 0
  for _, member in ipairs(expired) do
    expired_tokens = expired_tokens + member_tokens(member)
  end

  local raw_total = redis.call('GET', tpm_total_key)
  local had_total = raw_total ~= false
  local total = tonumber(raw_total or '0') or 0

  if #expired > 0 then
    redis.call('ZREMRANGEBYSCORE', tpm_key, '-inf', cutoff_ms)
  end

  local remaining = tonumber(redis.call('ZCARD', tpm_key) or '0')
  if remaining == 0 then
    redis.call('DEL', tpm_key)
    redis.call('DEL', tpm_total_key)
    return 0
  end

  if had_total then
    total = total - expired_tokens
  else
    total = sum_tpm_members(tpm_key)
  end

  if total > 0 then
    redis.call('SET', tpm_total_key, total)
    redis.call('PEXPIRE', tpm_total_key, ttl_ms)
    return total
  end

  redis.call('DEL', tpm_total_key)
  return 0
end
`;

// Derive effective concurrency from the per-model autostate hash. Mirrors deriveEffectiveConcurrency() in JS.
const AUTOSTATE_HELPER = `
local function compute_effective(autostate_key, rpm_limit, tpm_limit, ceiling, requested_tokens, default_latency_ms)
  local vals = redis.call('HMGET', autostate_key, 'lat', 'tok', 'bf')
  local lat = tonumber(vals[1])
  local tok = tonumber(vals[2])
  local bf = tonumber(vals[3])
  if lat == nil then lat = default_latency_ms end
  if tok == nil or tok <= 0 then tok = math.max(1, requested_tokens) end
  if bf == nil then bf = 1.0 end

  local BIG = 1e15
  local latency_s = lat / 1000.0
  local rps_rpm = BIG
  if rpm_limit > 0 then rps_rpm = rpm_limit / 60.0 end
  local rps_tpm = BIG
  if tpm_limit > 0 then rps_tpm = (tpm_limit / tok) / 60.0 end
  local rps_budget = math.min(rps_rpm, rps_tpm)
  local target
  if rps_budget >= BIG then
    target = ceiling
  else
    target = math.ceil(rps_budget * latency_s)
  end
  local effective = math.floor(target * bf + 0.5)
  if effective < 1 then effective = 1 end
  if effective > ceiling then effective = ceiling end
  return effective, bf, lat
end
`;

const ACQUIRE_SCRIPT = `
${SLIDING_WINDOW_HELPERS}
${AUTOSTATE_HELPER}
local rpm_key = KEYS[1]
local tpm_key = KEYS[2]
local tpm_total_key = KEYS[3]
local concurrency_key = KEYS[4]
local autostate_key = KEYS[5]
local concurrency_peak_base_key = KEYS[6]

local rpm_limit = tonumber(ARGV[1])
local tpm_limit = tonumber(ARGV[2])
local ceiling = tonumber(ARGV[3])
local requested_tokens = tonumber(ARGV[4])
local window_ms = tonumber(ARGV[5])
local concurrency_ttl_ms = tonumber(ARGV[6])
local request_member = ARGV[7]
local auto_concurrency = tonumber(ARGV[8])
local autostate_ttl_ms = tonumber(ARGV[9])
local default_latency_ms = tonumber(ARGV[10])
local ttl_ms = window_ms * 2

local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local cutoff_ms = now_ms - window_ms

local rpm = prune_rpm(rpm_key, cutoff_ms)
local tpm = prune_tpm(tpm_key, tpm_total_key, cutoff_ms, ttl_ms)
local concurrency = tonumber(redis.call('GET', concurrency_key) or '0')

local effective = ceiling
local bf = 1.0
local lat = -1
if auto_concurrency == 1 then
  effective, bf, lat = compute_effective(autostate_key, rpm_limit, tpm_limit, ceiling, requested_tokens, default_latency_ms)
end
local bf_out = math.floor(bf * 1000 + 0.5)
local lat_out = -1
if lat ~= nil and lat >= 0 then lat_out = math.floor(lat + 0.5) end

if rpm_limit > 0 and rpm + 1 > rpm_limit then
  local oldest = redis.call('ZRANGE', rpm_key, 0, 0, 'WITHSCORES')
  local retry_after_ms = window_ms
  if oldest[2] then
    retry_after_ms = math.max(0, tonumber(oldest[2]) + window_ms - now_ms)
  end
  return {0, retry_after_ms, 'rpm', effective, bf_out, lat_out}
end

if tpm_limit > 0 and tpm + requested_tokens > tpm_limit then
  local events = redis.call('ZRANGE', tpm_key, 0, -1, 'WITHSCORES')
  local projected = tpm
  local retry_at_ms = nil
  for i = 1, #events, 2 do
    projected = projected - member_tokens(events[i])
    if projected + requested_tokens <= tpm_limit then
      retry_at_ms = tonumber(events[i + 1]) + window_ms
      break
    end
  end

  local retry_after_ms = window_ms
  if retry_at_ms ~= nil then
    retry_after_ms = math.max(0, retry_at_ms - now_ms)
  end
  return {0, retry_after_ms, 'tpm', effective, bf_out, lat_out}
end

if effective > 0 and concurrency + 1 > effective then
  return {0, 250, 'concurrency', effective, bf_out, lat_out}
end

redis.call('ZADD', rpm_key, now_ms, request_member)
redis.call('ZADD', tpm_key, now_ms, request_member .. ':' .. requested_tokens)
redis.call('PEXPIRE', rpm_key, ttl_ms)
redis.call('PEXPIRE', tpm_key, ttl_ms)

local updated_tpm = tpm + requested_tokens
if updated_tpm > 0 then
  redis.call('SET', tpm_total_key, updated_tpm)
  redis.call('PEXPIRE', tpm_total_key, ttl_ms)
else
  redis.call('DEL', tpm_total_key)
end

local concurrency_after = tonumber(redis.call('INCR', concurrency_key) or '0')
redis.call('PEXPIRE', concurrency_key, concurrency_ttl_ms)

local minute_epoch_ms = math.floor(now_ms / 60000) * 60000
local concurrency_peak_key = concurrency_peak_base_key .. ':' .. minute_epoch_ms
local concurrency_peak = tonumber(redis.call('GET', concurrency_peak_key) or '0')
if concurrency_after > concurrency_peak then
  redis.call('SET', concurrency_peak_key, concurrency_after, 'PX', ttl_ms)
else
  redis.call('PEXPIRE', concurrency_peak_key, ttl_ms)
end

if auto_concurrency == 1 then
  redis.call('PEXPIRE', autostate_key, autostate_ttl_ms)
end

return {1, 0, 'ok', effective, bf_out, lat_out}
`;

// REPORT_SCRIPT — feed back per-call outcomes to adapt the auto-concurrency state.
// success: smooth latency/token EWMA + additive backoff recovery; upstream_throttle: multiplicative backoff.
const REPORT_SCRIPT = `
local autostate_key = KEYS[1]
local kind = ARGV[1]
local latency_ms = tonumber(ARGV[2])
local tokens = tonumber(ARGV[3])
local alpha = tonumber(ARGV[4])
local recover_step = tonumber(ARGV[5])
local mult = tonumber(ARGV[6])
local floor_bf = tonumber(ARGV[7])
local default_latency = tonumber(ARGV[8])
local ttl_ms = tonumber(ARGV[9])

local vals = redis.call('HMGET', autostate_key, 'lat', 'tok', 'bf')
local lat = tonumber(vals[1])
local tok = tonumber(vals[2])
local bf = tonumber(vals[3])
if bf == nil then bf = 1.0 end

if kind == 'success' then
  if latency_ms >= 0 then
    if lat == nil then lat = latency_ms else lat = alpha * latency_ms + (1 - alpha) * lat end
  elseif lat == nil then
    lat = default_latency
  end
  if tok == nil then tok = 0 end
  if tokens >= 0 then
    if tok <= 0 then tok = tokens else tok = alpha * tokens + (1 - alpha) * tok end
  end
  bf = math.min(1.0, bf + recover_step)
  redis.call('HSET', autostate_key, 'lat', lat, 'tok', tok, 'bf', bf)
else
  bf = math.max(floor_bf, bf * mult)
  redis.call('HSET', autostate_key, 'bf', bf)
end

redis.call('PEXPIRE', autostate_key, ttl_ms)
return math.floor(bf * 1000 + 0.5)
`;

const USAGE_SCRIPT = `
${SLIDING_WINDOW_HELPERS}
local window_ms = tonumber(ARGV[1])
local ttl_ms = window_ms * 2
local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local cutoff_ms = now_ms - window_ms

local rpm = prune_rpm(KEYS[1], cutoff_ms)
local tpm = prune_tpm(KEYS[2], KEYS[3], cutoff_ms, ttl_ms)
local concurrency = tonumber(redis.call('GET', KEYS[4]) or '0')
local minute_epoch_ms = math.floor(now_ms / 60000) * 60000
local concurrency_peak = tonumber(redis.call('GET', KEYS[6] .. ':' .. minute_epoch_ms) or '0')

local vals = redis.call('HMGET', KEYS[5], 'lat', 'tok', 'bf')
local lat = tonumber(vals[1])
local tok = tonumber(vals[2])
local bf = tonumber(vals[3])
local lat_out = -1
if lat ~= nil then lat_out = math.floor(lat + 0.5) end
local tok_out = -1
if tok ~= nil then tok_out = math.floor(tok + 0.5) end
local bf_out = -1
if bf ~= nil then bf_out = math.floor(bf * 1000 + 0.5) end

return {rpm, tpm, concurrency, now_ms, lat_out, tok_out, bf_out, concurrency_peak}
`;

// RELEASE_SCRIPT — floor at 0: prevent misuse from making the concurrency count negative
// When the count <= 0, DEL directly and return 0; the caller can interpret this as "nothing to release"
const RELEASE_SCRIPT = `
local concurrency = tonumber(redis.call('GET', KEYS[1]) or '0')
local concurrency_ttl_ms = tonumber(ARGV[1])

if concurrency <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end

if concurrency <= 1 then
  redis.call('DEL', KEYS[1])
  return 1
end

redis.call('DECR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], concurrency_ttl_ms)
return 1
`;

interface RedisEvalClient {
  eval(script: string, keyCount: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface RedisLimiterOptions {
  keyPrefix?: string;
  windowMs?: number;
  concurrencyTtlMs?: number;
  autostateTtlMs?: number;
  defaultLatencyMs?: number;
  ewmaAlpha?: number;
  backoffMult?: number;
  backoffFloor?: number;
  backoffRecoverStep?: number;
}

// Redis sliding window + Lua atomic script implementation
// See docs/specs/02-tech-stack.md §6 and §21 §6.1 (auto-concurrency)
export class RedisLimiter implements RateLimiter {
  private readonly keyPrefix: string;
  private readonly windowMs: number;
  private readonly concurrencyTtlMs: number;
  private readonly autostateTtlMs: number;
  private readonly defaultLatencyMs: number;
  private readonly ewmaAlpha: number;
  private readonly backoffMult: number;
  private readonly backoffFloor: number;
  private readonly backoffRecoverStep: number;

  constructor(
    private readonly redis: Redis | RedisEvalClient,
    options: RedisLimiterOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ph:limiter:llm';
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.concurrencyTtlMs = options.concurrencyTtlMs ?? DEFAULT_CONCURRENCY_TTL_MS;
    this.autostateTtlMs = options.autostateTtlMs ?? DEFAULT_AUTOSTATE_TTL_MS;
    this.defaultLatencyMs = options.defaultLatencyMs ?? DEFAULT_LATENCY_EWMA_MS;
    this.ewmaAlpha = options.ewmaAlpha ?? DEFAULT_EWMA_ALPHA;
    this.backoffMult = options.backoffMult ?? DEFAULT_BACKOFF_MULT;
    this.backoffFloor = options.backoffFloor ?? DEFAULT_BACKOFF_FLOOR;
    this.backoffRecoverStep = options.backoffRecoverStep ?? DEFAULT_BACKOFF_RECOVER_STEP;
  }

  async acquire(args: AcquireArgs): Promise<AcquireResult> {
    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const autoConcurrency = args.autoConcurrency === true;
    const startedAt = Date.now();
    let lastFailure: RateLimitExceededError | undefined;
    const requestMember = randomUUID();

    while (true) {
      const [rpmKey, tpmKey, tpmTotalKey, concurrencyKey, autostateKey, concurrencyPeakBaseKey] = this.keys(args.key);
      const result = await this.redis.eval(
        ACQUIRE_SCRIPT,
        6,
        rpmKey,
        tpmKey,
        tpmTotalKey,
        concurrencyKey,
        autostateKey,
        concurrencyPeakBaseKey,
        args.limits.rpmLimit,
        args.limits.tpmLimit,
        args.limits.concurrencyLimit,
        Math.max(0, Math.ceil(args.estimatedTokens)),
        this.windowMs,
        this.concurrencyTtlMs,
        requestMember,
        autoConcurrency ? 1 : 0,
        this.autostateTtlMs,
        this.defaultLatencyMs,
      );
      const [acquired, retryAfterMs, reason, effective, bfOut, latOut] = normalizeAcquireResult(result);

      if (acquired) {
        return {
          effectiveConcurrency: effective,
          backoffFactor: bfOut / 1000,
          latencyEwmaMs: latOut >= 0 ? latOut : this.defaultLatencyMs,
        };
      }

      lastFailure = new RateLimitExceededError(reason, retryAfterMs);
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) break;

      await sleep(Math.min(Math.max(retryAfterMs, pollIntervalMs), remainingMs));
    }

    throw lastFailure ?? new RateLimitExceededError('concurrency', pollIntervalMs);
  }

  async release(args: ReleaseArgs): Promise<void> {
    const concurrencyKey = this.concurrencyKey(args.key);
    await this.redis.eval(RELEASE_SCRIPT, 1, concurrencyKey, this.concurrencyTtlMs);
  }

  async reportOutcome(args: ReportOutcomeArgs): Promise<void> {
    const autostateKey = this.autostateKey(args.key);
    await this.redis.eval(
      REPORT_SCRIPT,
      1,
      autostateKey,
      args.kind,
      args.latencyMs !== undefined && args.latencyMs >= 0 ? Math.round(args.latencyMs) : -1,
      args.tokens !== undefined && args.tokens >= 0 ? Math.round(args.tokens) : -1,
      this.ewmaAlpha,
      this.backoffRecoverStep,
      this.backoffMult,
      this.backoffFloor,
      this.defaultLatencyMs,
      this.autostateTtlMs,
    );
  }

  async getUsage(key: string): Promise<UsageSnapshot> {
    const [rpmKey, tpmKey, tpmTotalKey, concurrencyKey, autostateKey, concurrencyPeakBaseKey] = this.keys(key);
    const result = await this.redis.eval(
      USAGE_SCRIPT,
      6,
      rpmKey,
      tpmKey,
      tpmTotalKey,
      concurrencyKey,
      autostateKey,
      concurrencyPeakBaseKey,
      this.windowMs,
    );
    const [rpmUsed, tpmUsed, concurrencyInUse, sampledAtMs, latOut, tokOut, bfOut, concurrencyPeakInMinute] =
      normalizeUsageResult(result);
    const sampledAt = new Date(sampledAtMs).toISOString();

    return {
      key,
      rpmUsed,
      tpmUsed,
      concurrencyInUse,
      concurrencyPeakInMinute,
      windowMs: this.windowMs,
      sampledAt,
      windowEndsAt: sampledAt,
      latencyEwmaMs: latOut >= 0 ? latOut : undefined,
      tokensEwma: tokOut >= 0 ? tokOut : undefined,
      backoffFactor: bfOut >= 0 ? bfOut / 1000 : undefined,
    };
  }

  private keys(key: string): [string, string, string, string, string, string] {
    return [
      `${this.keyPrefix}:${key}:rpm`,
      `${this.keyPrefix}:${key}:tpm`,
      `${this.keyPrefix}:${key}:tpm:total`,
      this.concurrencyKey(key),
      this.autostateKey(key),
      this.concurrencyPeakBaseKey(key),
    ];
  }

  private concurrencyKey(key: string): string {
    return `${this.keyPrefix}:${key}:concurrency`;
  }

  private autostateKey(key: string): string {
    return `${this.keyPrefix}:${key}:autostate`;
  }

  private concurrencyPeakBaseKey(key: string): string {
    return `${this.keyPrefix}:${key}:concurrency:peak`;
  }
}

function normalizeAcquireResult(
  result: unknown,
): [boolean, number, 'rpm' | 'tpm' | 'concurrency', number, number, number] {
  if (!Array.isArray(result)) {
    throw new Error('unexpected Redis limiter result');
  }

  const acquired = Number(result[0]) === 1;
  const retryAfterMs = Math.max(0, Number(result[1]) || 0);
  const reason = result[2] === 'rpm' || result[2] === 'tpm' ? result[2] : 'concurrency';
  const effective = parseCount(result[3]);
  const bfOut = parseCount(result[4]);
  const latOut = Number(result[5]);

  return [acquired, retryAfterMs, reason, effective, bfOut, Number.isFinite(latOut) ? latOut : -1];
}

function normalizeUsageResult(result: unknown): [number, number, number, number, number, number, number, number] {
  if (!Array.isArray(result)) {
    throw new Error('unexpected Redis limiter usage result');
  }

  const sampledAtMs = parseCount(result[3]) || Date.now();
  const latOut = Number(result[4]);
  const tokOut = Number(result[5]);
  const bfOut = Number(result[6]);
  const concurrencyPeakInMinute = parseCount(result[7]);
  return [
    parseCount(result[0]),
    parseCount(result[1]),
    parseCount(result[2]),
    sampledAtMs,
    Number.isFinite(latOut) ? latOut : -1,
    Number.isFinite(tokOut) ? tokOut : -1,
    Number.isFinite(bfOut) ? bfOut : -1,
    concurrencyPeakInMinute,
  ];
}

function parseCount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
