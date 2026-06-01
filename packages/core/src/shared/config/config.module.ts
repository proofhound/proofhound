import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(process.cwd(), '.env.local'),
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '../../.env.local'),
        resolve(process.cwd(), '../../.env'),
      ],
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
