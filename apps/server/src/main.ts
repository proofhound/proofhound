import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createHttpLogger, createLogger } from '@proofhound/logger';
import { json, urlencoded } from 'express';
import { ProofHoundServerModule, PinoExceptionFilter } from '@proofhound/core/server';
import { LocalContractsModule } from '@proofhound/core/contracts';
import { resolveListenPort } from './config/listen-port';

async function bootstrap() {
  const logger = createLogger('server.bootstrap', { service: 'server' });
  const bodyLimit = process.env.SERVER_BODY_LIMIT ?? '10mb';
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
    origin: process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalFilters(new PinoExceptionFilter('api'));

  const listenPort = resolveListenPort(process.env);
  await app.listen(listenPort.port);
  logger.info({ port: listenPort.port, portSource: listenPort.source, bodyLimit }, 'server_started');
}

bootstrap().catch((error: unknown) => {
  const logger = createLogger('server.bootstrap', { service: 'server' });
  logger.error({ error }, 'server_failed_to_start');
  process.exit(1);
});
