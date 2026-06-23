import { describe, expect, it, vi } from 'vitest';
import { RedisLimiter, deriveEffectiveConcurrency } from './redis-limiter';
import { RateLimitExceededError } from './types';

describe('RedisLimiter', () => {
  it('acquires and releases model concurrency through Redis scripts', async () => {
    const evalMock = vi.fn(async (script: string, _keyCount: number, ..._args: Array<string | number>) =>
      script.includes('return {1, 0') ? [1, 0, 'ok'] : 1,
    );
    const redis = { eval: evalMock };
    const limiter = new RedisLimiter(redis);

    await limiter.acquire({
      key: 'model-1',
      estimatedTokens: 12,
      limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 2 },
    });
    await limiter.release({ key: 'model-1' });

    expect(evalMock).toHaveBeenCalledTimes(2);
    // ACQUIRE takes 6 KEYS (rpm/tpm/tpm:total/concurrency/autostate/current-minute peak); RELEASE takes 1
    expect(evalMock.mock.calls[0]?.[1]).toBe(6);
    expect(evalMock.mock.calls[1]?.[1]).toBe(1);

    // ACQUIRE ARGV carries concurrency TTL (5 min), autostate TTL (30 min), default latency (3000ms),
    // the auto-concurrency flag (0 when not requested), and a string request member.
    const acquireArgs = evalMock.mock.calls[0]!;
    expect(acquireArgs).toContain(5 * 60_000);
    expect(acquireArgs).toContain(30 * 60_000);
    expect(acquireArgs).toContain(3000);
    expect(acquireArgs).toContain(0);
    expect(acquireArgs.some((arg) => typeof arg === 'string' && /^[0-9a-f-]{36}$/u.test(arg))).toBe(true);
  });

  it('uses Redis sorted sets for RPM and TPM sliding windows', async () => {
    const evalMock = vi.fn(async (_script: string, _keyCount: number, ..._args: Array<string | number>) => [
      1,
      0,
      'ok',
    ]);
    const redis = { eval: evalMock };
    const limiter = new RedisLimiter(redis);

    await limiter.acquire({
      key: 'model-1',
      estimatedTokens: 12,
      limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 2 },
    });

    const acquireScript = evalMock.mock.calls[0]?.[0] as string;
    expect(acquireScript).toMatch(/ZREMRANGEBYSCORE/);
    expect(acquireScript).toMatch(/ZADD', rpm_key/);
    expect(acquireScript).toMatch(/ZADD', tpm_key/);
    expect(acquireScript).toMatch(/tpm_total_key/);
  });

  it('records the current-minute concurrency peak after acquire succeeds', async () => {
    const evalMock = vi.fn(async (_script: string, _keyCount: number, ..._args: Array<string | number>) => [
      1,
      0,
      'ok',
    ]);
    const limiter = new RedisLimiter({ eval: evalMock });

    await limiter.acquire({
      key: 'model-1',
      estimatedTokens: 12,
      limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 2 },
    });

    const acquireScript = evalMock.mock.calls[0]?.[0] as string;
    expect(acquireScript).toMatch(/concurrency_peak_base_key/);
    expect(acquireScript).toMatch(/minute_epoch_ms/);
    expect(acquireScript).toMatch(/concurrency_after > concurrency_peak/);
  });

  it('can record RPM/TPM without reserving limiter concurrency', async () => {
    const evalMock = vi.fn(async (_script: string, _keyCount: number, ..._args: Array<string | number>) => [
      1,
      0,
      'ok',
      2,
      1000,
      3000,
    ]);
    const limiter = new RedisLimiter({ eval: evalMock });

    await limiter.acquire({
      key: 'model-1',
      estimatedTokens: 12,
      limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 2 },
      reserveConcurrency: false,
    });

    const acquireScript = evalMock.mock.calls[0]?.[0] as string;
    const acquireArgs = evalMock.mock.calls[0]!;
    expect(acquireScript).toMatch(/reserve_concurrency == 1/);
    expect(acquireArgs.at(-1)).toBe(0);
  });

  it('raises a typed error when the Redis script keeps rejecting on rpm', async () => {
    const redis = { eval: vi.fn(async () => [0, 0, 'rpm']) };
    const limiter = new RedisLimiter(redis);

    await expect(
      limiter.acquire({
        key: 'm',
        estimatedTokens: 12,
        timeoutMs: 0,
        pollIntervalMs: 0,
        limits: { rpmLimit: 1, tpmLimit: 1000, concurrencyLimit: 2 },
      }),
    ).rejects.toMatchObject({
      name: 'RateLimitExceededError',
      reason: 'rpm',
    });
  });

  it('raises with reason=tpm when TPM is the binding limit', async () => {
    const redis = { eval: vi.fn(async () => [0, 0, 'tpm']) };
    const limiter = new RedisLimiter(redis);

    await expect(
      limiter.acquire({
        key: 'm',
        estimatedTokens: 5000,
        timeoutMs: 0,
        pollIntervalMs: 0,
        limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 2 },
      }),
    ).rejects.toMatchObject({ reason: 'tpm' });
  });

  it('raises with reason=concurrency when slots are exhausted', async () => {
    const redis = { eval: vi.fn(async () => [0, 250, 'concurrency']) };
    const limiter = new RedisLimiter(redis);

    await expect(
      limiter.acquire({
        key: 'm',
        estimatedTokens: 10,
        timeoutMs: 0,
        pollIntervalMs: 0,
        limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 1 },
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('does not call release when acquire throws', async () => {
    const evalMock = vi.fn(async () => [0, 0, 'rpm']);
    const redis = { eval: evalMock };
    const limiter = new RedisLimiter(redis);

    await expect(
      limiter.acquire({
        key: 'm',
        estimatedTokens: 10,
        timeoutMs: 0,
        pollIntervalMs: 0,
        limits: { rpmLimit: 1, tpmLimit: 1000, concurrencyLimit: 2 },
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    // One ACQUIRE call, no RELEASE
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it('release script floors at zero (regression: never decrement below 0)', async () => {
    // Verify the floor branch by asserting against the script body itself, avoiding having to replicate Lua semantics in the mock
    const evalMock = vi.fn(async (_script: string) => 0);
    const redis = { eval: evalMock };
    const limiter = new RedisLimiter(redis);

    await limiter.release({ key: 'm' });
    const releaseScript = evalMock.mock.calls[0]?.[0] as string;
    expect(releaseScript).toMatch(/if concurrency <= 0 then/);
    expect(releaseScript).toMatch(/redis\.call\('DEL', KEYS\[1\]\)/);
  });

  it('getUsage reads sliding-window counters through Redis script', async () => {
    const sampledAtMs = Date.UTC(2026, 4, 20, 1, 2, 3);
    const evalMock = vi.fn(async (_script: string, _keyCount: number, ..._args: Array<string | number>) => [
      3,
      450,
      2,
      sampledAtMs,
      -1,
      -1,
      -1,
      4,
    ]);
    const redis = { eval: evalMock };
    const limiter = new RedisLimiter(redis as never);

    const usage = await limiter.getUsage('model-9');

    expect(usage).toMatchObject({
      key: 'model-9',
      rpmUsed: 3,
      tpmUsed: 450,
      concurrencyInUse: 2,
      concurrencyPeakInMinute: 4,
      windowMs: 60_000,
      sampledAt: new Date(sampledAtMs).toISOString(),
    });
    expect(usage.windowEndsAt).toBe(new Date(sampledAtMs).toISOString());
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0]?.[1]).toBe(6);
  });

  it('getUsage returns zeros when keys are missing', async () => {
    const redis = { eval: vi.fn(async () => [0, 0, 0, Date.now(), -1, -1, -1, 0]) };
    const limiter = new RedisLimiter(redis as never);

    const usage = await limiter.getUsage('cold-model');
    expect(usage).toMatchObject({
      key: 'cold-model',
      rpmUsed: 0,
      tpmUsed: 0,
      concurrencyInUse: 0,
      concurrencyPeakInMinute: 0,
    });
    expect(usage.latencyEwmaMs).toBeUndefined();
    expect(usage.tokensEwma).toBeUndefined();
    expect(usage.backoffFactor).toBeUndefined();
  });

  it('passes the auto-concurrency flag and returns the derived snapshot on acquire', async () => {
    const evalMock = vi.fn(async () => [1, 0, 'ok', 7, 850, 2500]);
    const limiter = new RedisLimiter({ eval: evalMock });

    const result = await limiter.acquire({
      key: 'm',
      estimatedTokens: 100,
      autoConcurrency: true,
      limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 20 },
    });

    expect(result).toEqual({ effectiveConcurrency: 7, backoffFactor: 0.85, latencyEwmaMs: 2500 });
    // auto flag (1) is present in ARGV
    expect(evalMock.mock.calls[0]).toContain(1);
  });

  it('getUsage surfaces auto-concurrency state (latency / tokens / backoff)', async () => {
    const sampledAtMs = Date.UTC(2026, 4, 20, 1, 2, 3);
    const redis = { eval: vi.fn(async () => [3, 450, 2, sampledAtMs, 2500, 1200, 850, 4]) };
    const limiter = new RedisLimiter(redis as never);

    const usage = await limiter.getUsage('m');
    expect(usage).toMatchObject({ latencyEwmaMs: 2500, tokensEwma: 1200, backoffFactor: 0.85 });
  });

  it('reportOutcome(success) sends latency + tokens to the REPORT script', async () => {
    const evalMock = vi.fn(async (_script: string, _keyCount: number, ..._args: Array<string | number>) => 1000);
    const limiter = new RedisLimiter({ eval: evalMock });

    await limiter.reportOutcome({ key: 'm', kind: 'success', latencyMs: 1234, tokens: 42 });

    const call = evalMock.mock.calls[0]!;
    expect(call[0]).toMatch(/HSET/);
    expect(call[1]).toBe(1); // single autostate key
    expect(call).toContain('success');
    expect(call).toContain(1234);
    expect(call).toContain(42);
  });

  it('reportOutcome(upstream_throttle) omits latency/tokens (sentinel -1)', async () => {
    const evalMock = vi.fn(async (_script: string, _keyCount: number, ..._args: Array<string | number>) => 500);
    const limiter = new RedisLimiter({ eval: evalMock });

    await limiter.reportOutcome({ key: 'm', kind: 'upstream_throttle' });

    const call = evalMock.mock.calls[0]!;
    expect(call).toContain('upstream_throttle');
    // latency and tokens both passed as -1 sentinel
    expect(call.filter((arg) => arg === -1).length).toBeGreaterThanOrEqual(2);
  });
});

describe("deriveEffectiveConcurrency (Little's Law + AIMD backoff)", () => {
  it('RPM binds: effective = ceil(rpm/60 × latency_s), clamped to ceiling', () => {
    // 60 rpm = 1 req/s; 5s latency → 5 concurrent needed
    expect(
      deriveEffectiveConcurrency({
        rpmLimit: 60,
        tpmLimit: -1,
        ceiling: 50,
        latencyEwmaMs: 5000,
        tokensEwma: 1000,
        backoffFactor: 1,
      }),
    ).toBe(5);
  });

  it('TPM binds when it implies fewer req/s than RPM', () => {
    // 6000 tpm / 1000 tok = 6 req/min = 0.1 req/s; 10s latency → ceil(1) = 1
    expect(
      deriveEffectiveConcurrency({
        rpmLimit: -1,
        tpmLimit: 6000,
        ceiling: 50,
        latencyEwmaMs: 10_000,
        tokensEwma: 1000,
        backoffFactor: 1,
      }),
    ).toBe(1);
  });

  it('both unlimited → target is the ceiling, scaled by backoff', () => {
    expect(
      deriveEffectiveConcurrency({
        rpmLimit: -1,
        tpmLimit: -1,
        ceiling: 8,
        latencyEwmaMs: 3000,
        tokensEwma: 1000,
        backoffFactor: 1,
      }),
    ).toBe(8);
    expect(
      deriveEffectiveConcurrency({
        rpmLimit: -1,
        tpmLimit: -1,
        ceiling: 8,
        latencyEwmaMs: 3000,
        tokensEwma: 1000,
        backoffFactor: 0.5,
      }),
    ).toBe(4);
  });

  it('clamps to the ceiling when the target exceeds it', () => {
    expect(
      deriveEffectiveConcurrency({
        rpmLimit: 100_000,
        tpmLimit: -1,
        ceiling: 20,
        latencyEwmaMs: 60_000,
        tokensEwma: 1000,
        backoffFactor: 1,
      }),
    ).toBe(20);
  });

  it('never drops below 1 even with a tiny backoff factor', () => {
    expect(
      deriveEffectiveConcurrency({
        rpmLimit: 60,
        tpmLimit: -1,
        ceiling: 50,
        latencyEwmaMs: 2000,
        tokensEwma: 1000,
        backoffFactor: 0.1,
      }),
    ).toBe(1);
  });
});
