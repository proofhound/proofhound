import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  SERVER_BODY_LIMIT: z.string().optional(),
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MODEL_API_KEY_ENCRYPTION_KEY: z.string().refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'MODEL_API_KEY_ENCRYPTION_KEY must be 32 random bytes encoded as base64'),
  PH_TRUSTED_USER_HEADER: z.string().trim().min(1).optional(),
  RELEASE_RUNNER_SCAN_INTERVAL_MS: z.coerce.number().int().positive().optional(),
  RELEASE_RUNNER_LOCK_TTL_MS: z.coerce.number().int().positive().optional(),
  DATASET_IMPORT_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().optional(),
  DATASET_IMPORT_STALE_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  DATASET_SYNC_CREATE_MAX_BYTES: z.coerce.number().int().positive().optional(),
});

export type Env = z.infer<typeof envSchema>;
