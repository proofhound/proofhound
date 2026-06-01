import { Module } from '@nestjs/common';
import { DbosService } from './dbos.service';

@Module({
  providers: [DbosService],
  exports: [DbosService],
})
export class DbosModule {}
