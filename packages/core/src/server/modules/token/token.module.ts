import { Module } from '@nestjs/common';
import { TokenController } from './token.controller';

@Module({
  // TokenService is supplied by the root contracts module. Do not bind a local default here:
  // a feature-module provider would shadow a replacement implementation's RemoteTokenService.
  controllers: [TokenController],
})
export class TokenModule {}
