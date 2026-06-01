import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringRepository } from './monitoring.repository';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MonitoringController],
  providers: [MonitoringRepository, MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
