import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { RedisMutexService } from '../redis-mutex.service';

function redisMock(options: { setResult?: 'OK' | null; evalResult?: number | string } = {}) {
  return {
    set: vi.fn().mockResolvedValue(Object.hasOwn(options, 'setResult') ? options.setResult : 'OK'),
    eval: vi.fn().mockResolvedValue(options.evalResult ?? 1),
  };
}

describe('RedisMutexService', () => {
  it('acquires a lock with SET NX PX and releases it only by owner token', async () => {
    const redis = redisMock();
    const service = new RedisMutexService(redis as unknown as Redis);

    const lease = await service.acquire({ key: 'proofhound:lock:test', ttlMs: 5_000 });

    expect(lease).not.toBeNull();
    expect(redis.set).toHaveBeenCalledWith('proofhound:lock:test', expect.any(String), 'PX', 5_000, 'NX');
    await lease!.release();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL'"),
      1,
      'proofhound:lock:test',
      lease!.token,
    );
  });

  it('returns null when the lock is already owned elsewhere', async () => {
    const redis = redisMock({ setResult: null });
    const service = new RedisMutexService(redis as unknown as Redis);

    await expect(service.acquire({ key: 'proofhound:lock:test', ttlMs: 5_000 })).resolves.toBeNull();
  });

  it('renews the lock only while the owner token still matches', async () => {
    const redis = redisMock();
    const service = new RedisMutexService(redis as unknown as Redis);
    const lease = await service.acquire({ key: 'proofhound:lock:test', ttlMs: 5_000 });

    await expect(lease!.renew()).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('PEXPIRE'"),
      1,
      'proofhound:lock:test',
      lease!.token,
      5_000,
    );
  });

  it('reports false when renew or release loses ownership', async () => {
    const redis = redisMock({ evalResult: 0 });
    const service = new RedisMutexService(redis as unknown as Redis);
    const lease = await service.acquire({ key: 'proofhound:lock:test', ttlMs: 5_000 });

    await expect(lease!.renew()).resolves.toBe(false);
    await expect(lease!.release()).resolves.toBe(false);
  });
});
