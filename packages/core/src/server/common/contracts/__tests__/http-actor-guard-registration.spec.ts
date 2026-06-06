import { GUARDS_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AnnotationController } from '../../../modules/annotation/annotation.controller';
import { AnnotationModule } from '../../../modules/annotation/annotation.module';
import { CanaryReleaseController } from '../../../modules/canary-release/canary-release.controller';
import { CanaryReleaseModule } from '../../../modules/canary-release/canary-release.module';
import { ConnectorController } from '../../../modules/connector/connector.controller';
import { ConnectorModule } from '../../../modules/connector/connector.module';
import { DatasetController } from '../../../modules/dataset/dataset.controller';
import { DatasetModule } from '../../../modules/dataset/dataset.module';
import { ExperimentController } from '../../../modules/experiment/experiment.controller';
import { ExperimentModule } from '../../../modules/experiment/experiment.module';
import { ModelController } from '../../../modules/model/model.controller';
import { ModelModule } from '../../../modules/model/model.module';
import { ProjectModelController } from '../../../modules/model/project-model.controller';
import { MonitoringController } from '../../../modules/monitoring/monitoring.controller';
import { MonitoringModule } from '../../../modules/monitoring/monitoring.module';
import { OptimizationController } from '../../../modules/optimization/optimization.controller';
import { OptimizationModule } from '../../../modules/optimization/optimization.module';
import { ProductionReleaseController } from '../../../modules/production-release/production-release.controller';
import { ProductionReleaseModule } from '../../../modules/production-release/production-release.module';
import { PromptController } from '../../../modules/prompt/prompt.controller';
import { PromptModule } from '../../../modules/prompt/prompt.module';
import { QuickStartController } from '../../../modules/quick-start/quick-start.controller';
import { QuickStartModule } from '../../../modules/quick-start/quick-start.module';
import { ReleaseLineController } from '../../../modules/release-line/release-line.controller';
import { ReleaseLineModule } from '../../../modules/release-line/release-line.module';
import { ReleaseRunResultController, RunResultController } from '../../../modules/run-result/run-result.controller';
import { RunResultModule } from '../../../modules/run-result/run-result.module';
import { TokenController } from '../../../modules/token/token.controller';
import { TokenModule } from '../../../modules/token/token.module';
import { ModelService } from '../../../modules/model/model.service';
import { LOCAL_PROJECT_CONTEXT } from '@proofhound/shared';
import { ActorContextResolver } from '../actor-context.resolver';
import { ProjectContextResolver } from '../project-context.resolver';
import { HttpActorGuard } from '../http-actor.guard';

const guardedModules = [
  { module: AnnotationModule, controllers: [AnnotationController] },
  { module: CanaryReleaseModule, controllers: [CanaryReleaseController] },
  { module: ConnectorModule, controllers: [ConnectorController] },
  { module: DatasetModule, controllers: [DatasetController] },
  { module: ExperimentModule, controllers: [ExperimentController] },
  { module: ModelModule, controllers: [ModelController, ProjectModelController] },
  { module: MonitoringModule, controllers: [MonitoringController] },
  { module: OptimizationModule, controllers: [OptimizationController] },
  { module: ProductionReleaseModule, controllers: [ProductionReleaseController] },
  { module: PromptModule, controllers: [PromptController] },
  { module: QuickStartModule, controllers: [QuickStartController] },
  { module: ReleaseLineModule, controllers: [ReleaseLineController] },
  { module: RunResultModule, controllers: [RunResultController, ReleaseRunResultController] },
  { module: TokenModule, controllers: [TokenController] },
];

describe('HttpActorGuard module registration', () => {
  it.each(guardedModules)(
    '$module.name declares HttpActorGuard on its HTTP controllers',
    ({ module, controllers }) => {
      const moduleControllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module) ?? [];
      for (const controller of controllers) {
        expect(moduleControllers).toContain(controller);
        const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
        expect(guards).toContain(HttpActorGuard);
      }
    },
  );

  it('executes the local HttpActorGuard for ProjectModelController routes', async () => {
    const resolveFromHttp = vi.fn().mockResolvedValue({ actorId: 'local-test', actorKind: 'local_user' });
    const listProjectModels = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectModelController],
      providers: [
        { provide: ActorContextResolver, useValue: { resolveFromHttp, resolveFromUserToken: vi.fn() } },
        { provide: ProjectContextResolver, useValue: { resolve: vi.fn().mockResolvedValue(LOCAL_PROJECT_CONTEXT) } },
        { provide: ModelService, useValue: { listProjectModels } },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer()).get('/models').expect(200);

    expect(resolveFromHttp).toHaveBeenCalledTimes(1);
    expect(listProjectModels).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ actorId: 'local-test', actorKind: 'local_user' }),
      undefined,
    );
    await app.close();
  });
});
