import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { AnnotationController } from './annotation.controller';
import { AnnotationRepository } from './annotation.repository';
import { AnnotationService } from './annotation.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AnnotationController],
  providers: [AnnotationRepository, AnnotationService],
  exports: [AnnotationService],
})
export class AnnotationModule {}
