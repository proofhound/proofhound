/**
 * Auto-concurrency self-regulation demo (see docs/specs/21-models.md §6.1).
 *
 * Drives a real RedisLimiter through a scripted sequence of outcomes and prints the
 * effective-concurrency trajectory step by step, so you can watch the two control loops:
 *   1. Little's Law  — effective tracks RPM/TPM × observed latency (EWMA)
 *   2. AIMD backoff  — upstream 429 halves the backoff factor; success recovers it additively
 *
 * Run (needs a local Redis):
 *   REDIS_TEST_URL=redis://localhost:6379 pnpm --filter @proofhound/limiter demo:auto-concurrency
 */
import Redis from 'ioredis';
import { RedisLimiter } from '../src/redis-limiter';

const REDIS_URL = process.env['REDIS_TEST_URL'] ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const MODEL_ID = `demo-auto-${Date.now()}`;
const KEY_PREFIX = `ph:demo:limiter:${Date.now()}`;

// 600 RPM = 10 req/s, TPM unlimited, ceiling 50 → Little's Law target = 10 × latency_s, clamped to 50.
const LIMITS = { rpmLimit: 600, tpmLimit: -1, concurrencyLimit: 50 };
const TOKENS = 800;

type Step =
  | { kind: 'cold'; phase: string; note: string }
  | { kind: 'success'; phase: string; latencyMs: number; note?: string }
  | { kind: 'throttle'; phase: string; note?: string };

function scenario(): Step[] {
  const steps: Step[] = [];
  steps.push({ kind: 'cold', phase: 'cold', note: 'no data yet → assumes default 3000ms latency' });

  // Phase A1: first real samples at 1s latency → effective settles near 10
  for (let i = 0; i < 4; i += 1) {
    steps.push({ kind: 'success', phase: 'A·latency', latencyMs: 1000, note: i === 0 ? 'seed EWMA to first observed latency' : undefined });
  }
  // Phase A2: latency rises to 4s → effective climbs toward 40 (EWMA smooths the ramp)
  for (let i = 0; i < 7; i += 1) {
    steps.push({ kind: 'success', phase: 'A·latency', latencyMs: 4000, note: i === 0 ? 'latency jumps 1s→4s, target climbs' : undefined });
  }
  // Phase B: provider starts returning 429 → multiplicative backoff (×0.5 each, floor 0.1)
  for (let i = 0; i < 4; i += 1) {
    steps.push({ kind: 'throttle', phase: 'B·429 backoff', note: i === 0 ? 'upstream 429 → backoff ×0.5' : undefined });
  }
  // Phase C: provider recovers → additive recovery (+0.05 per success); note the AIMD asymmetry
  for (let i = 0; i < 10; i += 1) {
    steps.push({ kind: 'success', phase: 'C·recovery', latencyMs: 4000, note: i === 0 ? 'successes resume → backoff +0.05 each' : undefined });
  }
  return steps;
}

function bar(effective: number): string {
  return '█'.repeat(Math.min(50, Math.max(0, Math.round(effective))));
}

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function padStart(value: string | number, width: number): string {
  return String(value).padStart(width);
}

async function main(): Promise<void> {
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  await redis.ping();
  const limiter = new RedisLimiter(redis, { keyPrefix: KEY_PREFIX });

  process.stdout.write(
    `\nAuto-concurrency trajectory  (RPM=${LIMITS.rpmLimit}, TPM=${LIMITS.tpmLimit}, ceiling=${LIMITS.concurrencyLimit}, model=${MODEL_ID})\n`,
  );
  process.stdout.write(
    `${pad('#', 4)}${pad('phase', 16)}${pad('event', 14)}${padStart('lat_ewma', 9)}${padStart('bf', 7)}${padStart('eff', 5)}  trajectory / note\n`,
  );
  process.stdout.write(`${'-'.repeat(96)}\n`);

  const steps = scenario();
  let lastPhase = '';

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;

    // 1) feed the outcome (the feedback signal)
    if (step.kind === 'success') {
      await limiter.reportOutcome({ key: MODEL_ID, kind: 'success', latencyMs: step.latencyMs, tokens: TOKENS });
    } else if (step.kind === 'throttle') {
      await limiter.reportOutcome({ key: MODEL_ID, kind: 'upstream_throttle' });
    }

    // 2) read the authoritative effective the limiter would gate at right now
    const result = await limiter.acquire({
      key: MODEL_ID,
      estimatedTokens: TOKENS,
      autoConcurrency: true,
      limits: LIMITS,
      timeoutMs: 0,
    });
    await limiter.release({ key: MODEL_ID });
    const { effectiveConcurrency: eff, backoffFactor: bf, latencyEwmaMs: lat } = result ?? {
      effectiveConcurrency: 0,
      backoffFactor: 0,
      latencyEwmaMs: 0,
    };

    const eventLabel = step.kind === 'success' ? `success(${step.latencyMs}ms)` : step.kind === 'throttle' ? '429-throttle' : 'cold-start';
    const phaseLabel = step.phase === lastPhase ? '' : step.phase;
    lastPhase = step.phase;
    const note = 'note' in step && step.note ? `  ← ${step.note}` : '';

    process.stdout.write(
      `${pad(i, 4)}${pad(phaseLabel, 16)}${pad(eventLabel, 14)}${padStart(Math.round(lat), 9)}${padStart(bf.toFixed(2), 7)}${padStart(eff, 5)}  ${bar(eff)}${note}\n`,
    );
  }

  process.stdout.write(`${'-'.repeat(96)}\n`);
  process.stdout.write('Loop 1 (latency tracking): eff follows RPM/60 × latency, clamped to the ceiling.\n');
  process.stdout.write('Loop 2 (AIMD): 429 halves eff multiplicatively; recovery adds back slowly — note the asymmetry.\n\n');

  const keys = await redis.keys(`${KEY_PREFIX}:*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
