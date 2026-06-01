import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisLimiter } from './redis-limiter';
import { RateLimitExceededError } from './types';

// Integration test: skipped by default; enabled when REDIS_TEST_URL is set
// Locally: docker compose -f dev/docker-compose.yml up -d redis
//      REDIS_TEST_URL=redis://localhost:6379 pnpm --filter @proofhound/limiter test:integration
const REDIS_URL = process.env['REDIS_TEST_URL'];
const describeIf = REDIS_URL ? describe : describe.skip;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeIf('RedisLimiter (integration, real Redis)', () => {
  let redis: Redis;
  let limiter: RedisLimiter;
  const keyPrefix = `ph:test:limiter:${Date.now()}`;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL!, { maxRetriesPerRequest: null, lazyConnect: false });
    await redis.ping();
  });

  afterAll(async () => {
    const keys = await redis.keys(`${keyPrefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  });

  beforeEach(async () => {
    const keys = await redis.keys(`${keyPrefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    // Default 1s window + 200ms concurrency TTL, for ease of cross-window / self-healing tests
    limiter = new RedisLimiter(redis, { keyPrefix, windowMs: 1_000, concurrencyTtlMs: 200 });
  });

  it('enforces RPM and recovers after requests slide out of the window', async () => {
    const limits = { rpmLimit: 2, tpmLimit: 1_000_000, concurrencyLimit: 10 };

    await limiter.acquire({ key: 'm1', estimatedTokens: 10, limits, timeoutMs: 0 });
    await limiter.acquire({ key: 'm1', estimatedTokens: 10, limits, timeoutMs: 0 });

    await expect(
      limiter.acquire({
        key: 'm1',
        estimatedTokens: 10,
        limits,
        timeoutMs: 0,
        pollIntervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    // wait until accepted requests are outside the sliding window
    await sleep(1_200);
    await limiter.acquire({ key: 'm1', estimatedTokens: 10, limits, timeoutMs: 0 });
  }, 10_000);

  it('enforces TPM by summing estimatedTokens within the sliding window', async () => {
    const limits = { rpmLimit: 100, tpmLimit: 100, concurrencyLimit: 10 };

    await limiter.acquire({ key: 'm2', estimatedTokens: 60, limits, timeoutMs: 0 });
    await expect(
      limiter.acquire({
        key: 'm2',
        estimatedTokens: 60,
        limits,
        timeoutMs: 0,
        pollIntervalMs: 0,
      }),
    ).rejects.toMatchObject({ reason: 'tpm' });
  });

  it('enforces concurrency atomically under parallel acquires', async () => {
    const limits = { rpmLimit: 1000, tpmLimit: 1_000_000, concurrencyLimit: 2 };
    // 5 concurrent acquires; expect only 2 to succeed and the rest to throw
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }).map(() =>
        limiter.acquire({
          key: 'm3',
          estimatedTokens: 10,
          limits,
          timeoutMs: 0,
          pollIntervalMs: 0,
        }),
      ),
    );

    const succeeded = attempts.filter((a) => a.status === 'fulfilled').length;
    const failed = attempts.filter((a) => a.status === 'rejected').length;
    expect(succeeded).toBe(2);
    expect(failed).toBe(3);
  });

  it('release floors at zero (does not produce negative concurrency)', async () => {
    // First release three times without any acquire
    await limiter.release({ key: 'm4' });
    await limiter.release({ key: 'm4' });
    await limiter.release({ key: 'm4' });

    const usage = await limiter.getUsage('m4');
    expect(usage.concurrencyInUse).toBe(0);

    // Subsequent acquire/release works fine; no residual negative value
    const limits = { rpmLimit: 100, tpmLimit: 1_000_000, concurrencyLimit: 1 };
    await limiter.acquire({ key: 'm4', estimatedTokens: 1, limits, timeoutMs: 0 });
    expect((await limiter.getUsage('m4')).concurrencyInUse).toBe(1);
    await limiter.release({ key: 'm4' });
    expect((await limiter.getUsage('m4')).concurrencyInUse).toBe(0);
  });

  it('concurrency key self-heals via TTL after process crash (no release)', async () => {
    const limits = { rpmLimit: 1000, tpmLimit: 1_000_000, concurrencyLimit: 1 };

    await limiter.acquire({ key: 'm5', estimatedTokens: 1, limits, timeoutMs: 0 });
    expect((await limiter.getUsage('m5')).concurrencyInUse).toBe(1);

    // Simulate "process crashed without releasing" — wait concurrencyTtlMs (200ms) to expire
    await sleep(300);

    expect((await limiter.getUsage('m5')).concurrencyInUse).toBe(0);
    // Now acquire can proceed again
    await limiter.acquire({ key: 'm5', estimatedTokens: 1, limits, timeoutMs: 0 });
    expect((await limiter.getUsage('m5')).concurrencyInUse).toBe(1);
  }, 5_000);

  it('getUsage returns current sliding-window rpm/tpm/concurrency snapshot', async () => {
    const limits = { rpmLimit: 100, tpmLimit: 1_000_000, concurrencyLimit: 10 };
    await limiter.acquire({ key: 'm6', estimatedTokens: 25, limits, timeoutMs: 0 });
    await limiter.acquire({ key: 'm6', estimatedTokens: 25, limits, timeoutMs: 0 });

    const usage = await limiter.getUsage('m6');
    expect(usage.rpmUsed).toBe(2);
    expect(usage.tpmUsed).toBe(50);
    expect(usage.concurrencyInUse).toBe(2);
    expect(usage.windowMs).toBe(1_000);
  });

  it('getUsage prunes expired RPM and TPM entries', async () => {
    const limits = { rpmLimit: 100, tpmLimit: 1_000_000, concurrencyLimit: 10 };
    await limiter.acquire({ key: 'm7', estimatedTokens: 25, limits, timeoutMs: 0 });
    expect((await limiter.getUsage('m7')).rpmUsed).toBe(1);

    await sleep(1_200);

    const usage = await limiter.getUsage('m7');
    expect(usage.rpmUsed).toBe(0);
    expect(usage.tpmUsed).toBe(0);
  }, 5_000);

  // --- auto-concurrency (Little's Law + AIMD backoff), exercised through the real Lua ---

  it('auto-concurrency gates at the derived effective (not the ceiling)', async () => {
    // Seed autostate: 5s latency, 1000 tok/req, backoff 1.0
    await redis.hset(`${keyPrefix}:a1:autostate`, 'lat', 5000, 'tok', 1000, 'bf', 1);
    // 60 rpm = 1 req/s; 5s latency → effective = ceil(1 × 5) = 5, far below ceiling 50
    const limits = { rpmLimit: 60, tpmLimit: -1, concurrencyLimit: 50 };

    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire({ key: 'a1', estimatedTokens: 100, limits, autoConcurrency: true, timeoutMs: 0 });
    }
    await expect(
      limiter.acquire({
        key: 'a1',
        estimatedTokens: 100,
        limits,
        autoConcurrency: true,
        timeoutMs: 0,
        pollIntervalMs: 0,
      }),
    ).rejects.toMatchObject({ reason: 'concurrency' });
  });

  it('auto=false ignores autostate and uses the ceiling', async () => {
    // Same seed that would shrink effective to ~5 under auto
    await redis.hset(`${keyPrefix}:a2:autostate`, 'lat', 5000, 'tok', 1000, 'bf', 0.1);
    const limits = { rpmLimit: 600, tpmLimit: -1, concurrencyLimit: 8 };

    // Without autoConcurrency, 8 (the ceiling) in-flight all succeed
    for (let i = 0; i < 8; i += 1) {
      await limiter.acquire({ key: 'a2', estimatedTokens: 10, limits, timeoutMs: 0 });
    }
    await expect(
      limiter.acquire({ key: 'a2', estimatedTokens: 10, limits, timeoutMs: 0, pollIntervalMs: 0 }),
    ).rejects.toMatchObject({ reason: 'concurrency' });
  });

  it('upstream_throttle drives the backoff factor down to the floor', async () => {
    const tuned = new RedisLimiter(redis, {
      keyPrefix,
      windowMs: 1_000,
      backoffMult: 0.5,
      backoffFloor: 0.1,
    });
    for (let i = 0; i < 10; i += 1) {
      await tuned.reportOutcome({ key: 'a3', kind: 'upstream_throttle' });
    }
    const usage = await tuned.getUsage('a3');
    expect(usage.backoffFactor).toBeCloseTo(0.1, 5);
  });

  it('success recovers the backoff additively and updates the latency EWMA', async () => {
    const tuned = new RedisLimiter(redis, {
      keyPrefix,
      windowMs: 1_000,
      ewmaAlpha: 0.3,
      backoffRecoverStep: 0.05,
      backoffMult: 0.5,
      backoffFloor: 0.1,
    });
    // Drive backoff down first, then recover with successes
    await tuned.reportOutcome({ key: 'a4', kind: 'upstream_throttle' }); // bf: 1 → 0.5
    await tuned.reportOutcome({ key: 'a4', kind: 'success', latencyMs: 2000, tokens: 500 }); // bf: 0.55
    await tuned.reportOutcome({ key: 'a4', kind: 'success', latencyMs: 2000, tokens: 500 }); // bf: 0.60

    const usage = await tuned.getUsage('a4');
    expect(usage.backoffFactor).toBeCloseTo(0.6, 5);
    // First success seeds EWMA at 2000 (no prior), second keeps it at 2000
    expect(usage.latencyEwmaMs).toBe(2000);
    expect(usage.tokensEwma).toBe(500);
  });

  it('throttle never touches latency/token EWMA', async () => {
    const tuned = new RedisLimiter(redis, { keyPrefix, windowMs: 1_000 });
    await tuned.reportOutcome({ key: 'a5', kind: 'success', latencyMs: 3000, tokens: 800 });
    await tuned.reportOutcome({ key: 'a5', kind: 'upstream_throttle' });
    const usage = await tuned.getUsage('a5');
    expect(usage.latencyEwmaMs).toBe(3000);
    expect(usage.tokensEwma).toBe(800);
    expect(usage.backoffFactor).toBeLessThan(1);
  });
});
