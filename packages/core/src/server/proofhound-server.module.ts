import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { ConfigModule } from '../shared/config/config.module';
import { ProjectContextModule } from './common/project-context.module';
import { CryptoModule } from '../shared/crypto/crypto.module';
import { DatabaseModule } from '../shared/database/database.module';
import { RedisModule } from '../shared/redis/redis.module';
import { HealthController } from '../shared/health/health.controller';
import { HealthService } from '../shared/health/health.service';
import { OrchestrationModule } from './infrastructure/orchestration';
import { OptimizationModule } from './modules/optimization/optimization.module';
import { ConnectorModule } from './modules/connector/connector.module';
import { DatasetModule } from './modules/dataset/dataset.module';
import { ExperimentModule } from './modules/experiment/experiment.module';
import { ModelModule } from './modules/model/model.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { AnnotationModule } from './modules/annotation/annotation.module';
import { CanaryReleaseModule } from './modules/canary-release/canary-release.module';
import { ProductionReleaseModule } from './modules/production-release/production-release.module';
import { PromptModule } from './modules/prompt/prompt.module';
import { QuickStartModule } from './modules/quick-start/quick-start.module';
import { ReleaseLineModule } from './modules/release-line/release-line.module';
import { RunResultModule } from './modules/run-result/run-result.module';
import { TokenModule } from './modules/token/token.module';

// ProofHoundServerModule — the shared server root module, assembled as a dynamic module via forRoot
// so the `contracts` adapter bindings are supplied at boot instead of hard-coded. OSS passes
// LocalContractsModule (Local* defaults); a SaaS shell passes its own SaasContractsModule
// (Remote* implementations). See docs/specs/08-saas-adapter-boundary.md §2.
export interface ProofHoundServerModuleOptions {
  // A @Global module binding every adapter extension-point token to an implementation.
  // OSS: LocalContractsModule. SaaS: SaasContractsModule. The root module never imports a
  // concrete Local* / Remote* class directly — only this supplied module does the binding.
  contracts: Type<unknown> | DynamicModule;
}

@Module({})
export class ProofHoundServerModule {
  static forRoot(options: ProofHoundServerModuleOptions): DynamicModule {
    return {
      module: ProofHoundServerModule,
      imports: [
        ConfigModule,
        options.contracts,
        ProjectContextModule,
        CryptoModule,
        DatabaseModule,
        OrchestrationModule,
        RedisModule,
        ModelModule,
        MonitoringModule,
        AnnotationModule,
        DatasetModule,
        PromptModule,
        RunResultModule,
        TokenModule,
        ExperimentModule,
        OptimizationModule,
        QuickStartModule,
        ReleaseLineModule,
        ConnectorModule,
        CanaryReleaseModule,
        ProductionReleaseModule,
      ],
      controllers: [HealthController],
      providers: [HealthService],
    };
  }
}
