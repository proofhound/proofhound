import { Global, Module } from '@nestjs/common';
import { ProjectContextProvider } from './project-context';

@Global()
@Module({
  providers: [ProjectContextProvider],
  exports: [ProjectContextProvider],
})
export class ProjectContextModule {}
