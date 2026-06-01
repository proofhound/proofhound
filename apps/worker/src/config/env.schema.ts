import { z } from 'zod';
import { DEFAULT_WORKER_CONCURRENCY } from '@proofhound/core/worker';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).optional(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WORKER_QUEUES: z.string().default('llm,probe'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(DEFAULT_WORKER_CONCURRENCY),
  MODEL_API_KEY_ENCRYPTION_KEY: z
    .string()
    .refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'MODEL_API_KEY_ENCRYPTION_KEY must be 32 random bytes encoded as base64'),
});

export type Env = z.infer<typeof envSchema>;
