import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { RedisModule } from '../../../shared/redis/redis.module';
import { PromptTryRunService } from './prompt-try-run.service';
import { PromptController } from './prompt.controller';
import { PromptRepository } from './prompt.repository';
import { PromptService } from './prompt.service';

// PromptDeletionHook (08 §3.16) is provided by the global contracts module so an override `contracts`
// module can replace it without this feature module shadowing the binding; PromptService injects it
// from the global provider.
@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [PromptController],
  providers: [PromptRepository, PromptService, PromptTryRunService],
  exports: [PromptService, PromptRepository, PromptTryRunService],
})
export class PromptModule {}
