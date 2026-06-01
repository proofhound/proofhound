import type { DbClient } from '@proofhound/db';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { HealthService } from '../health.service';

function makeService(options: { dbError?: Error; redisError?: Error } = {}) {
  const db = {
    execute: options.dbError ? vi.fn().mockRejectedValue(options.dbError) : vi.fn().mockResolvedValue([{ ok: 1 }]),
  } as unknown as DbClient;
  const redis = {
    ping: options.redisError ? vi.fn().mockRejectedValue(options.redisError) : vi.fn().mockResolvedValue('PONG'),
  } as unknown as Redis;

  return { service: new HealthService(db, redis), db, redis };
}

describe('HealthService', () => {
  it('returns shallow liveness without dependency checks', () => {
    const { service, db, redis } = makeService();

    expect(service.liveness()).toEqual({ status: 'ok' });
    expect(db.execute).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('returns ready when database and redis checks pass', async () => {
    const { service } = makeService();

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ok',
      checks: {
        database: { status: 'ok' },
        redis: { status: 'ok' },
      },
    });
  });

  it('returns error when a dependency check fails', async () => {
    const { service } = makeService({ dbError: new Error('database down') });

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'error',
      checks: {
        database: { status: 'error', errorClass: 'Error' },
        redis: { status: 'ok' },
      },
    });
  });
});
