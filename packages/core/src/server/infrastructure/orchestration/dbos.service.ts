import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createLogger } from '@proofhound/logger';

// In-process DBOS workflow runtime NestJS host
// See docs/specs/03-orchestration.md §1
@Injectable()
export class DbosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('server.dbos', { service: 'server' });

  async onModuleInit(): Promise<void> {
    this.logger.info({}, 'dbos_runtime_starting');
    DBOS.setConfig({
      name: 'proofhound-server',
      systemDatabaseUrl: process.env['DATABASE_URL'] ?? '',
    });
    try {
      await DBOS.launch();
      this.logger.info({}, 'dbos_runtime_started');
    } catch (error) {
      this.logger.error({ error }, 'dbos_runtime_launch_failed');
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await DBOS.shutdown();
    this.logger.info({}, 'dbos_runtime_stopped');
  }
}
