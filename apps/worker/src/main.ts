import 'reflect-metadata';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@proofhound/logger';
import { envSchema } from './config/env.schema';

function loadRootEnv(): void {
  for (const candidate of [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env.local'),
    resolve(process.cwd(), '../../.env'),
  ]) {
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      // Try the next conventional location.
    }
  }
}

async function bootstrap(): Promise<void> {
  loadRootEnv();

  const env = envSchema.parse(process.env);
  const logger = createLogger('worker.bootstrap', { service: 'worker', level: env.LOG_LEVEL });
  const { ProofHoundWorkerModule } = await import('@proofhound/core/worker');

  const app = await NestFactory.createApplicationContext(ProofHoundWorkerModule, { abortOnError: true });
  app.enableShutdownHooks();

  logger.info({ queues: ['llm', 'probe'], concurrency: env.WORKER_CONCURRENCY }, 'worker_started');
}

bootstrap().catch((error: unknown) => {
  const logger = createLogger('worker.bootstrap', { service: 'worker' });
  logger.error({ error }, 'worker_failed_to_start');
  process.exit(1);
});
