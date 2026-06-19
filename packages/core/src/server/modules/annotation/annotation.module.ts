import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { RunResultModule } from '../run-result/run-result.module';
import { AnnotationController } from './annotation.controller';
import { AnnotationRepository } from './annotation.repository';
import { AnnotationService } from './annotation.service';

@Module({
  imports: [DatabaseModule, RunResultModule],
  controllers: [AnnotationController],
  providers: [AnnotationRepository, AnnotationService],
  exports: [AnnotationService],
})
export class AnnotationModule {}
