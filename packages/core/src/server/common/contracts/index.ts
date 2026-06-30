// Adapter extension point barrel — abstract class + default implementations + types
// See docs/specs/08-adapter-extension-points.md

export * from './types';
export * from './project-context.resolver';
export * from './actor-context.resolver';
export * from './mcp-auth.resolver';
export * from './access-control.service';
export * from './connector-context.resolver';
export * from './token.service';
export * from './limiter-key.strategy';
export * from './runtime-limits.provider';
export * from './quota-policy.hook';
export * from './usage-metering.hook';
export * from './workflow-authorization.hook';
export {
  DatasetUploadService,
  type DatasetUploadInput,
} from '../../modules/dataset/dataset-upload.contract';
export { LocalDatasetUploadService } from '../../modules/dataset/dataset-import.service';
export {
  DatasetSampleRepository,
  type DatasetSampleRow,
  type DatasetSampleExportCursor,
  type DatasetSampleExportBatch,
} from '../../modules/dataset/dataset-sample.repository.contract';
export { LocalDatasetSampleRepository } from '../../modules/dataset/local-dataset-sample.repository';
export { DatasetImportRepository } from '../../modules/dataset/dataset-import.repository';
export {
  DatasetDeletionHook,
  LocalDatasetDeletionHook,
  type DatasetDeletionHookInput,
} from '../../modules/dataset/dataset-deletion.hook';
export {
  PromptDeletionHook,
  LocalPromptDeletionHook,
  type PromptDeletionHookInput,
} from '../../modules/prompt/prompt-deletion.hook';
export {
  ReleaseLineDeletionHook,
  LocalReleaseLineDeletionHook,
  type ReleaseLineDeletionHookInput,
} from '../../modules/release-line/release-line-deletion.hook';
export * from './http-actor.guard';
export * from './local-project-context.resolver';
export * from './local-actor-context.resolver';
export * from './local-mcp-auth.resolver';
export * from './local-access-control.service';
export * from './local-user-token.verifier';
export { LocalTokenService } from '../../modules/token/token.service';
export * from '../../modules/token/token.repository';
export { LocalConnectorContextResolver } from '../../../webhook/channels/webhook/local-connector-context.resolver';
export * from '../../../webhook/channels/webhook/webhook.repository';
export { LocalContractsModule } from './local-contracts.module';
