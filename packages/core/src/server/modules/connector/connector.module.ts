import { Module } from '@nestjs/common';
import { CryptoModule } from '../../../shared/crypto/crypto.module';
import { DatabaseModule } from '../../../shared/database/database.module';
import { ConnectorController } from './connector.controller';
import { ConnectorDriverFactory } from './connector.driver-factory';
import { ConnectorRepository } from './connector.repository';
import { ConnectorService } from './connector.service';

@Module({
  imports: [CryptoModule, DatabaseModule],
  controllers: [ConnectorController],
  providers: [ConnectorRepository, ConnectorService, ConnectorDriverFactory],
  exports: [ConnectorService, ConnectorDriverFactory],
})
export class ConnectorModule {}
