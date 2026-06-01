import { Module } from '@nestjs/common';
import { CryptoModule } from '../../../shared/crypto/crypto.module';
import { DatabaseModule } from '../../../shared/database/database.module';
import { TokenController } from './token.controller';
import { TokenRepository } from './token.repository';
import { LocalTokenService, TokenService } from './token.service';

@Module({
  imports: [CryptoModule, DatabaseModule],
  controllers: [TokenController],
  providers: [TokenRepository, { provide: TokenService, useClass: LocalTokenService }],
  exports: [TokenService],
})
export class TokenModule {}
