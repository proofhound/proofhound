import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { ReleaseLineModule } from '../release-line/release-line.module';
import { ProductionReleaseController } from './production-release.controller';
import { ProductionReleaseRepository } from './production-release.repository';
import { ProductionReleaseService } from './production-release.service';

@Module({
  imports: [DatabaseModule, ReleaseLineModule],
  controllers: [ProductionReleaseController],
  providers: [ProductionReleaseRepository, ProductionReleaseService],
  exports: [ProductionReleaseService],
})
export class ProductionReleaseModule {}
