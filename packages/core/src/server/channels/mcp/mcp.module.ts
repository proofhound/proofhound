// McpModule — mounts the MCP server (Streamable HTTP) at /mcp.
// See docs/specs/09-mcp-server.md.
//
// Imports every domain feature module (each exports its Service), assembles the full tool list from
// the `createXxxTools(service)` aggregators into the MCP_TOOLS token, and wires the transport +
// controller. Auth is the transport's job (McpAuthResolver, global via LocalContractsModule), so the
// MCP controller is NOT under @UseGuards(HttpActorGuard).

import { Module } from '@nestjs/common';
import { AnnotationModule } from '../../modules/annotation/annotation.module';
import { AnnotationService } from '../../modules/annotation/annotation.service';
import { CanaryReleaseModule } from '../../modules/canary-release/canary-release.module';
import { CanaryReleaseService } from '../../modules/canary-release/canary-release.service';
import { ConnectorModule } from '../../modules/connector/connector.module';
import { ConnectorService } from '../../modules/connector/connector.service';
import { DatasetModule } from '../../modules/dataset/dataset.module';
import { DatasetImportService } from '../../modules/dataset/dataset-import.service';
import { DatasetService } from '../../modules/dataset/dataset.service';
import { ExperimentModule } from '../../modules/experiment/experiment.module';
import { ExperimentService } from '../../modules/experiment/experiment.service';
import { ModelModule } from '../../modules/model/model.module';
import { ModelService } from '../../modules/model/model.service';
import { MonitoringModule } from '../../modules/monitoring/monitoring.module';
import { MonitoringService } from '../../modules/monitoring/monitoring.service';
import { OptimizationModule } from '../../modules/optimization/optimization.module';
import { OptimizationService } from '../../modules/optimization/optimization.service';
import { PromptModule } from '../../modules/prompt/prompt.module';
import { PromptTryRunService } from '../../modules/prompt/prompt-try-run.service';
import { PromptService } from '../../modules/prompt/prompt.service';
import { QuickStartModule } from '../../modules/quick-start/quick-start.module';
import { QuickStartService } from '../../modules/quick-start/quick-start.service';
import { ReleaseLineModule } from '../../modules/release-line/release-line.module';
import { ReleaseLineService } from '../../modules/release-line/release-line.service';
import { RunResultModule } from '../../modules/run-result/run-result.module';
import { RunResultService } from '../../modules/run-result/run-result.service';
import { TokenModule } from '../../modules/token/token.module';
import { TokenService } from '../../common/contracts/token.service';
import {
  createAnnotationTools,
  createCanaryReleaseTools,
  createConnectorTools,
  createDatasetImportTools,
  createDatasetTools,
  createExperimentTools,
  createModelTools,
  createMonitoringTools,
  createOptimizationTools,
  createPromptTools,
  createQuickStartTools,
  createReleaseLineTools,
  createRunResultTools,
  createTokenTools,
} from './index';
import { McpDispatchContextFactory } from './mcp-context';
import { McpController } from './mcp.controller';
import { MCP_TOOLS } from './mcp.tokens';
import { McpTransportService } from './mcp.transport';
import type { McpToolDefinition } from './mcp.types';

@Module({
  imports: [
    AnnotationModule,
    CanaryReleaseModule,
    ConnectorModule,
    DatasetModule,
    ExperimentModule,
    ModelModule,
    MonitoringModule,
    OptimizationModule,
    PromptModule,
    QuickStartModule,
    ReleaseLineModule,
    RunResultModule,
    TokenModule,
  ],
  controllers: [McpController],
  providers: [
    McpDispatchContextFactory,
    McpTransportService,
    {
      provide: MCP_TOOLS,
      useFactory: (
        annotation: AnnotationService,
        canary: CanaryReleaseService,
        connector: ConnectorService,
        datasetImport: DatasetImportService,
        dataset: DatasetService,
        experiment: ExperimentService,
        model: ModelService,
        monitoring: MonitoringService,
        optimization: OptimizationService,
        prompt: PromptService,
        promptTryRun: PromptTryRunService,
        quickStart: QuickStartService,
        releaseLine: ReleaseLineService,
        runResult: RunResultService,
        token: TokenService,
      ): McpToolDefinition[] => [
        ...createAnnotationTools(annotation),
        ...createCanaryReleaseTools(canary),
        ...createConnectorTools(connector),
        ...createDatasetImportTools(datasetImport),
        ...createDatasetTools(dataset),
        ...createExperimentTools(experiment),
        ...createModelTools(model),
        ...createMonitoringTools(monitoring),
        ...createOptimizationTools(optimization),
        ...createPromptTools(prompt, promptTryRun),
        ...createQuickStartTools(quickStart),
        ...createReleaseLineTools(releaseLine),
        ...createRunResultTools(runResult),
        ...createTokenTools(token),
      ],
      inject: [
        AnnotationService,
        CanaryReleaseService,
        ConnectorService,
        DatasetImportService,
        DatasetService,
        ExperimentService,
        ModelService,
        MonitoringService,
        OptimizationService,
        PromptService,
        PromptTryRunService,
        QuickStartService,
        ReleaseLineService,
        RunResultService,
        TokenService,
      ],
    },
  ],
})
export class McpModule {}
