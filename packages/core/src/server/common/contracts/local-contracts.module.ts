// LocalContractsModule — the OSS default `contracts` module: binds each adapter extension-point
// token to its Local* implementation.
// See docs/specs/08-adapter-extension-points.md §2 + §3.
//
// Supplied to the root `AppModule.forRoot({ contracts })` at assembly time. A replacement shell passes its
// own override `contracts` module (binding Remote* implementations) the same way; OSS mainline is unaware
// of which contracts module was supplied. `overrideProvider` stays a test-only primitive (§2).
//
// @Global() ensures every feature module can inject these resolvers without a per-module import.

import { Global, Module } from '@nestjs/common';
import { CryptoModule } from '../../../shared/crypto/crypto.module';
import { DatabaseModule } from '../../../shared/database/database.module';
import { LocalConnectorContextResolver } from '../../../webhook/channels/webhook/local-connector-context.resolver';
import { WebhookRepository } from '../../../webhook/channels/webhook/webhook.repository';
import { TokenRepository } from '../../modules/token/token.repository';
import { LocalTokenService } from '../../modules/token/token.service';
import { AccessControlService } from './access-control.service';
import { ActorContextResolver } from './actor-context.resolver';
import { ConnectorContextResolver } from './connector-context.resolver';
import { LimiterKeyStrategy, LocalLimiterKeyStrategy } from './limiter-key.strategy';
import { LocalAccessControlService } from './local-access-control.service';
import { LocalActorContextResolver } from './local-actor-context.resolver';
import { LocalMcpAuthResolver } from './local-mcp-auth.resolver';
import { LocalProjectContextResolver } from './local-project-context.resolver';
import { LocalUserTokenVerifier } from './local-user-token.verifier';
import { McpAuthResolver } from './mcp-auth.resolver';
import { DatasetImportRepository } from '../../modules/dataset/dataset-import.repository';
import { LocalDatasetUploadService } from '../../modules/dataset/dataset-import.service';
import { DatasetUploadService } from '../../modules/dataset/dataset-upload.contract';
import { ProjectContextResolver } from './project-context.resolver';
import { LocalQuotaPolicyHook, QuotaPolicyHook } from './quota-policy.hook';
import { LocalRuntimeLimitsProvider, RuntimeLimitsProvider } from './runtime-limits.provider';
import { TokenService } from './token.service';
import { NoopUsageMeteringHook, UsageMeteringHook } from './usage-metering.hook';
import { LocalWorkflowAuthorizationHook, WorkflowAuthorizationHook } from './workflow-authorization.hook';

@Global()
@Module({
  imports: [CryptoModule, DatabaseModule],
  providers: [
    WebhookRepository,
    TokenRepository,
    LocalUserTokenVerifier,
    { provide: ProjectContextResolver, useClass: LocalProjectContextResolver },
    { provide: ActorContextResolver, useClass: LocalActorContextResolver },
    { provide: McpAuthResolver, useClass: LocalMcpAuthResolver },
    { provide: ConnectorContextResolver, useClass: LocalConnectorContextResolver },
    { provide: TokenService, useClass: LocalTokenService },
    { provide: AccessControlService, useClass: LocalAccessControlService },
    { provide: LimiterKeyStrategy, useClass: LocalLimiterKeyStrategy },
    { provide: RuntimeLimitsProvider, useClass: LocalRuntimeLimitsProvider },
    { provide: QuotaPolicyHook, useClass: LocalQuotaPolicyHook },
    { provide: UsageMeteringHook, useClass: NoopUsageMeteringHook },
    { provide: WorkflowAuthorizationHook, useClass: LocalWorkflowAuthorizationHook },
    DatasetImportRepository,
    { provide: DatasetUploadService, useClass: LocalDatasetUploadService },
  ],
  exports: [
    ProjectContextResolver,
    ActorContextResolver,
    McpAuthResolver,
    ConnectorContextResolver,
    TokenService,
    AccessControlService,
    LimiterKeyStrategy,
    RuntimeLimitsProvider,
    QuotaPolicyHook,
    UsageMeteringHook,
    WorkflowAuthorizationHook,
    DatasetUploadService,
    LocalUserTokenVerifier,
  ],
})
export class LocalContractsModule {}
