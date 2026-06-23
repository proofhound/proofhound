import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { llmJobPayloadSchema, type LlmJobPayload } from '@proofhound/orchestration-shared';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

const DEFAULT_PREFIX = 'ph:llm-admission';
const DEFAULT_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_READY_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEASE_TTL_MS = 10 * 60 * 1000;

const ENQUEUE_PENDING_SCRIPT = `
local dedupe_key = KEYS[1]
local job_key = KEYS[2]
local list_key = KEYS[3]
local keys_key = KEYS[4]

local job_id = ARGV[1]
local job_json = ARGV[2]
local fairness_key = ARGV[3]
local not_before_ms = tonumber(ARGV[4])
local ttl_ms = tonumber(ARGV[5])

local inserted = redis.call('SET', dedupe_key, 'pending', 'NX', 'PX', ttl_ms)
if not inserted then
  return 0
end

redis.call('SET', job_key, job_json, 'PX', ttl_ms)
redis.call('RPUSH', list_key, job_id)
redis.call('PEXPIRE', list_key, ttl_ms)
redis.call('ZADD', keys_key, not_before_ms, fairness_key)
redis.call('PEXPIRE', keys_key, ttl_ms)
return 1
`;

const MARK_READY_SCRIPT = `
local list_key = KEYS[1]
local job_key = KEYS[2]
local dedupe_key = KEYS[3]
local keys_key = KEYS[4]

local job_id = ARGV[1]
local fairness_key = ARGV[2]
local now_ms = tonumber(ARGV[3])
local ready_ttl_ms = tonumber(ARGV[4])

redis.call('LREM', list_key, 1, job_id)
redis.call('DEL', job_key)
redis.call('SET', dedupe_key, 'ready', 'PX', ready_ttl_ms)

local remaining = tonumber(redis.call('LLEN', list_key) or '0')
if remaining > 0 then
  redis.call('ZADD', keys_key, now_ms, fairness_key)
else
  redis.call('ZREM', keys_key, fairness_key)
  redis.call('DEL', list_key)
end

return remaining
`;

const TRY_RESERVE_SCRIPT = `
local lease_key = KEYS[1]

local now_ms = tonumber(ARGV[1])
local ttl_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local reservation_id = ARGV[4]

redis.call('ZREMRANGEBYSCORE', lease_key, '-inf', now_ms)
local current = tonumber(redis.call('ZCARD', lease_key) or '0')
if limit <= 0 or current >= limit then
  return 0
end

redis.call('ZADD', lease_key, now_ms + ttl_ms, reservation_id)
redis.call('PEXPIRE', lease_key, ttl_ms)
return 1
`;

const EXTEND_RESERVATION_SCRIPT = `
local lease_key = KEYS[1]

local now_ms = tonumber(ARGV[1])
local ttl_ms = tonumber(ARGV[2])
local reservation_id = ARGV[3]

redis.call('ZREMRANGEBYSCORE', lease_key, '-inf', now_ms)
local existing = redis.call('ZSCORE', lease_key, reservation_id)
if not existing then
  return 0
end

redis.call('ZADD', lease_key, now_ms + ttl_ms, reservation_id)
redis.call('PEXPIRE', lease_key, ttl_ms)
return 1
`;

const ACQUIRE_LEADER_SCRIPT = `
local leader_key = KEYS[1]
local instance_id = ARGV[1]
local ttl_ms = tonumber(ARGV[2])

local current = redis.call('GET', leader_key)
if not current or current == instance_id then
  redis.call('SET', leader_key, instance_id, 'PX', ttl_ms)
  return 1
end

return 0
`;

export interface PendingLlmJob {
  jobId: string;
  fairnessKey: string;
  payload: LlmJobPayload;
  enqueuedAtMs: number;
  notBeforeMs: number;
}

export interface EnqueuePendingLlmJobInput {
  jobId: string;
  fairnessKey: string;
  payload: LlmJobPayload;
  notBeforeMs?: number;
}

export interface LlmAdmissionReservation {
  fairnessKey: string;
  reservationId: string;
}

@Injectable()
export class LlmAdmissionStore {
  private readonly prefix = process.env['PH_LLM_ADMISSION_REDIS_PREFIX'] ?? DEFAULT_PREFIX;
  private readonly pendingTtlMs = positiveIntEnv('PH_LLM_ADMISSION_PENDING_TTL_MS', DEFAULT_PENDING_TTL_MS);
  private readonly readyDedupeTtlMs = positiveIntEnv('PH_LLM_ADMISSION_READY_DEDUPE_TTL_MS', DEFAULT_READY_DEDUPE_TTL_MS);
  private readonly leaseTtlMs = positiveIntEnv('PH_LLM_ADMISSION_LEASE_TTL_MS', DEFAULT_LEASE_TTL_MS);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  get defaultLeaseTtlMs(): number {
    return this.leaseTtlMs;
  }

  async enqueuePendingLlmJob(input: EnqueuePendingLlmJobInput): Promise<boolean> {
    const now = Date.now();
    const notBeforeMs = input.notBeforeMs ?? now;
    const pending: PendingLlmJob = {
      jobId: input.jobId,
      fairnessKey: input.fairnessKey,
      payload: llmJobPayloadSchema.parse(input.payload),
      enqueuedAtMs: now,
      notBeforeMs,
    };
    const result = await this.redis.eval(
      ENQUEUE_PENDING_SCRIPT,
      4,
      this.dedupeKey(input.jobId),
      this.jobKey(input.jobId),
      this.pendingListKey(input.fairnessKey),
      this.pendingKeysKey(),
      input.jobId,
      JSON.stringify(pending),
      input.fairnessKey,
      notBeforeMs,
      this.pendingTtlMs,
    );
    return Number(result) === 1;
  }

  async getDueFairnessKeys(limit: number, nowMs = Date.now()): Promise<string[]> {
    if (limit <= 0) return [];
    return this.redis.zrangebyscore(this.pendingKeysKey(), '-inf', String(nowMs), 'LIMIT', 0, limit);
  }

  async peekNextPendingJob(fairnessKey: string): Promise<PendingLlmJob | null> {
    const listKey = this.pendingListKey(fairnessKey);
    while (true) {
      const jobId = await this.redis.lindex(listKey, 0);
      if (!jobId) {
        await this.redis.zrem(this.pendingKeysKey(), fairnessKey);
        return null;
      }

      const pending = await this.getPendingLlmJob(jobId);
      if (pending) return pending;
      await this.redis.lpop(listKey);
    }
  }

  async getPendingLlmJob(jobId: string): Promise<PendingLlmJob | null> {
    const raw = await this.redis.get(this.jobKey(jobId));
    if (!raw) return null;
    return decodePendingLlmJob(raw);
  }

  async findPendingLlmJobIds(jobIds: readonly string[]): Promise<string[]> {
    const found: string[] = [];
    for (const jobId of new Set(jobIds)) {
      if (await this.getPendingLlmJob(jobId)) found.push(jobId);
    }
    return found;
  }

  async removePendingLlmJobs(jobIds: readonly string[]): Promise<string[]> {
    const removed: string[] = [];
    for (const jobId of new Set(jobIds)) {
      const pending = await this.getPendingLlmJob(jobId);
      if (!pending) continue;

      const listKey = this.pendingListKey(pending.fairnessKey);
      await this.redis
        .multi()
        .lrem(listKey, 1, jobId)
        .del(this.jobKey(jobId))
        .del(this.dedupeKey(jobId))
        .exec();

      const remaining = await this.redis.llen(listKey);
      if (remaining > 0) {
        await this.redis.zadd(this.pendingKeysKey(), Date.now(), pending.fairnessKey);
      } else {
        await this.redis.multi().zrem(this.pendingKeysKey(), pending.fairnessKey).del(listKey).exec();
      }
      removed.push(jobId);
    }
    return removed;
  }

  async clearLlmJobDedupe(jobIds: readonly string[]): Promise<void> {
    const uniqueJobIds = [...new Set(jobIds)];
    if (uniqueJobIds.length === 0) return;
    const pipeline = this.redis.multi();
    for (const jobId of uniqueJobIds) {
      pipeline.del(this.dedupeKey(jobId));
    }
    await pipeline.exec();
  }

  async markLlmJobReady(jobId: string, fairnessKey: string): Promise<void> {
    await this.redis.eval(
      MARK_READY_SCRIPT,
      4,
      this.pendingListKey(fairnessKey),
      this.jobKey(jobId),
      this.dedupeKey(jobId),
      this.pendingKeysKey(),
      jobId,
      fairnessKey,
      Date.now(),
      this.readyDedupeTtlMs,
    );
  }

  async scheduleFairnessKey(fairnessKey: string, notBeforeMs: number): Promise<void> {
    await this.redis.zadd(this.pendingKeysKey(), notBeforeMs, fairnessKey);
  }

  async tryReserveConcurrency(
    reservation: LlmAdmissionReservation,
    concurrencyLimit: number,
    ttlMs = this.leaseTtlMs,
  ): Promise<boolean> {
    const result = await this.redis.eval(
      TRY_RESERVE_SCRIPT,
      1,
      this.leaseKey(reservation.fairnessKey),
      Date.now(),
      ttlMs,
      concurrencyLimit,
      reservation.reservationId,
    );
    return Number(result) === 1;
  }

  async extendConcurrencyReservation(reservation: LlmAdmissionReservation, ttlMs = this.leaseTtlMs): Promise<boolean> {
    const result = await this.redis.eval(
      EXTEND_RESERVATION_SCRIPT,
      1,
      this.leaseKey(reservation.fairnessKey),
      Date.now(),
      ttlMs,
      reservation.reservationId,
    );
    return Number(result) === 1;
  }

  async releaseConcurrencyReservation(reservation: LlmAdmissionReservation): Promise<void> {
    await this.redis.zrem(this.leaseKey(reservation.fairnessKey), reservation.reservationId);
  }

  async acquireDispatcherLeadership(instanceId: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.eval(
      ACQUIRE_LEADER_SCRIPT,
      1,
      this.dispatcherLeaderKey(),
      instanceId,
      ttlMs,
    );
    return Number(result) === 1;
  }

  private pendingKeysKey(): string {
    return `${this.prefix}:pending:keys`;
  }

  private pendingListKey(fairnessKey: string): string {
    return `${this.prefix}:pending:key:${hashKey(fairnessKey)}`;
  }

  private jobKey(jobId: string): string {
    return `${this.prefix}:pending:job:${jobId}`;
  }

  private dedupeKey(jobId: string): string {
    return `${this.prefix}:dedupe:${jobId}`;
  }

  private leaseKey(fairnessKey: string): string {
    return `${this.prefix}:lease:${hashKey(fairnessKey)}`;
  }

  private dispatcherLeaderKey(): string {
    return `${this.prefix}:dispatcher:leader`;
  }
}

function decodePendingLlmJob(raw: string): PendingLlmJob | null {
  try {
    const decoded = JSON.parse(raw) as PendingLlmJob;
    return {
      jobId: String(decoded.jobId),
      fairnessKey: String(decoded.fairnessKey),
      payload: llmJobPayloadSchema.parse(decoded.payload),
      enqueuedAtMs: Number(decoded.enqueuedAtMs),
      notBeforeMs: Number(decoded.notBeforeMs),
    };
  } catch {
    return null;
  }
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
