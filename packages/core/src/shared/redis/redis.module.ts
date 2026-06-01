import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { RedisLimiter } from '@proofhound/limiter';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_LIMITER } from './redis.constants';
import { RedisMutexService } from './redis-mutex.service';

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null }),
    },
    {
      provide: REDIS_LIMITER,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => new RedisLimiter(redis),
    },
    RedisMutexService,
  ],
  exports: [REDIS_CLIENT, REDIS_LIMITER, RedisMutexService],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(ModuleRef) private readonly moduleRef: ModuleRef) {}

  async onModuleDestroy(): Promise<void> {
    const redis = this.moduleRef.get<Redis>(REDIS_CLIENT, { strict: false });
    await redis?.quit();
  }
}
