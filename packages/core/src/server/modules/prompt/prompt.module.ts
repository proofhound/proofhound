import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { RedisModule } from '../../../shared/redis/redis.module';
import { LocalPromptDeletionHook, PromptDeletionHook } from './prompt-deletion.hook';
import { PromptTryRunService } from './prompt-try-run.service';
import { PromptController } from './prompt.controller';
import { PromptRepository } from './prompt.repository';
import { PromptService } from './prompt.service';

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [PromptController],
  providers: [
    PromptRepository,
    { provide: PromptDeletionHook, useClass: LocalPromptDeletionHook },
    PromptService,
    PromptTryRunService,
  ],
  exports: [PromptService, PromptRepository, PromptTryRunService],
})
export class PromptModule {}
