// LocalContractsModule — the OSS default `contracts` module: binds each adapter extension-point
// token to its Local* implementation.
// See docs/specs/08-saas-adapter-boundary.md §2 + §3.
//
// Supplied to the root `AppModule.forRoot({ contracts })` at assembly time. A SaaS shell passes its
// own `SaasContractsModule` (binding Remote* implementations) the same way; OSS mainline is unaware
// of which contracts module was supplied. `overrideProvider` stays a test-only primitive (§2).
//
// @Global() ensures every feature module can inject these resolvers without a per-module import.

import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../../shared/database/database.module';
import { AccessControlService } from './access-control.service';
import { ActorContextResolver } from './actor-context.resolver';
import { LocalAccessControlService } from './local-access-control.service';
import { LocalActorContextResolver } from './local-actor-context.resolver';
import { LocalMcpAuthResolver } from './local-mcp-auth.resolver';
import { LocalProjectContextResolver } from './local-project-context.resolver';
import { LocalUserTokenVerifier } from './local-user-token.verifier';
import { McpAuthResolver } from './mcp-auth.resolver';
import { ProjectContextResolver } from './project-context.resolver';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    LocalUserTokenVerifier,
    { provide: ProjectContextResolver, useClass: LocalProjectContextResolver },
    { provide: ActorContextResolver, useClass: LocalActorContextResolver },
    { provide: McpAuthResolver, useClass: LocalMcpAuthResolver },
    { provide: AccessControlService, useClass: LocalAccessControlService },
  ],
  exports: [
    ProjectContextResolver,
    ActorContextResolver,
    McpAuthResolver,
    AccessControlService,
    LocalUserTokenVerifier,
  ],
})
export class LocalContractsModule {}
