import { Module } from '@nestjs/common';
import { createDbClient } from '@proofhound/db';
import { DATABASE_CLIENT } from './database.constants';

@Module({
  providers: [
    {
      provide: DATABASE_CLIENT,
      useFactory: () => createDbClient(process.env['DATABASE_URL'] ?? ''),
    },
  ],
  exports: [DATABASE_CLIENT],
})
export class DatabaseModule {}
