import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '@proofhound/db';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DATABASE_CLIENT } from '../database/database.constants';
import { REDIS_CLIENT } from '../redis/redis.constants';

const CHECK_TIMEOUT_MS = 1_000;

type CheckName = 'database' | 'redis';
type CheckStatus = 'ok' | 'error';

export interface HealthCheckResult {
  status: CheckStatus;
  latencyMs: number;
  errorClass?: string;
}

export interface ReadinessResult {
  status: CheckStatus;
  checks: Record<CheckName, HealthCheckResult>;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly db: DbClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  liveness() {
    return { status: 'ok' };
  }

  async readiness(): Promise<ReadinessResult> {
    const [database, redis] = await Promise.all([
      this.checkDependency('database', () => this.db.execute(sql`SELECT 1`)),
      this.checkDependency('redis', () => this.redis.ping()),
    ]);

    return {
      status: database.status === 'ok' && redis.status === 'ok' ? 'ok' : 'error',
      checks: { database, redis },
    };
  }

  private async checkDependency(name: CheckName, operation: () => Promise<unknown>): Promise<HealthCheckResult> {
    const startedAt = Date.now();

    try {
      await withTimeout(operation(), CHECK_TIMEOUT_MS, name);
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      };
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${name}_health_check_timeout`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
