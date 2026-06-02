import 'reflect-metadata';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { createHttpLogger, createLogger } from '@proofhound/logger';
import { json, urlencoded } from 'express';
import { ProofHoundServerModule, PinoExceptionFilter } from '@proofhound/core/server';
import { LocalContractsModule } from '@proofhound/core/contracts';
import { envSchema } from './config/env.schema';
import { resolveListenPort } from './config/listen-port';

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
  const logger = createLogger('server.bootstrap', { service: 'server', level: env.LOG_LEVEL });
  const bodyLimit = env.SERVER_BODY_LIMIT ?? '10mb';
  logger.info({}, 'server_bootstrap_start');
  const app = await NestFactory.create(
    ProofHoundServerModule.forRoot({ contracts: LocalContractsModule }),
    { bodyParser: false },
  );
  logger.info({}, 'server_nest_app_created');
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.use(createHttpLogger({ service: 'server' }));
  app.enableCors({
    origin: env.WEB_PUBLIC_URL,
    credentials: true,
  });
  app.useGlobalFilters(new PinoExceptionFilter('api'));

  const listenPort = resolveListenPort(env);
  await app.listen(listenPort.port);
  logger.info({ port: listenPort.port, portSource: listenPort.source, bodyLimit }, 'server_started');
}

bootstrap().catch((error: unknown) => {
  const logger = createLogger('server.bootstrap', { service: 'server' });
  logger.error({ error }, 'server_failed_to_start');
  process.exit(1);
});
