import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

const RELEASE_IF_OWNER_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const RENEW_IF_OWNER_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

export interface RedisMutexAcquireInput {
  key: string;
  ttlMs: number;
}

export class RedisMutexLease {
  constructor(
    private readonly redis: Redis,
    readonly key: string,
    readonly token: string,
    readonly ttlMs: number,
  ) {}

  async renew(): Promise<boolean> {
    const result = await this.redis.eval(RENEW_IF_OWNER_SCRIPT, 1, this.key, this.token, this.ttlMs);
    return isRedisTruthy(result);
  }

  async release(): Promise<boolean> {
    const result = await this.redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, this.key, this.token);
    return isRedisTruthy(result);
  }
}

@Injectable()
export class RedisMutexService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async acquire(input: RedisMutexAcquireInput): Promise<RedisMutexLease | null> {
    const key = input.key.trim();
    const ttlMs = Math.floor(input.ttlMs);
    if (key.length === 0) throw new Error('redis_mutex_key_required');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('redis_mutex_invalid_ttl');

    const token = randomUUID();
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    if (result !== 'OK') return null;
    return new RedisMutexLease(this.redis, key, token, ttlMs);
  }
}

function isRedisTruthy(result: unknown): boolean {
  return result === 1 || result === '1';
}
