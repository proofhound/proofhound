import 'reflect-metadata';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@proofhound/logger';
import { envSchema } from './config/env.schema';
import { ProofHoundWorkerModule } from '@proofhound/core/worker';

function loadRootEnv(): void {
  try {
    process.loadEnvFile(resolve(process.cwd(), '../../.env'));
  } catch {
    // Missing .env in CI / containerized deploys is expected.
  }
}

async function bootstrap(): Promise<void> {
  loadRootEnv();

  const env = envSchema.parse(process.env);
  const logger = createLogger('worker.bootstrap', { service: 'worker', level: env.LOG_LEVEL });

  const app = await NestFactory.createApplicationContext(ProofHoundWorkerModule, { abortOnError: true });
  app.enableShutdownHooks();

  const queues = env.WORKER_QUEUES.split(',')
    .map((q) => q.trim())
    .filter(Boolean);
  logger.info({ queues, concurrency: env.WORKER_CONCURRENCY }, 'worker_started');
}

bootstrap().catch((error: unknown) => {
  const logger = createLogger('worker.bootstrap', { service: 'worker' });
  logger.error({ error }, 'worker_failed_to_start');
  process.exit(1);
});
