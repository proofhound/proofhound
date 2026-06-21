/**
 * MCP tool definitions for dataset import.
 * Delegates to DatasetImportService, matching the REST batch-import surface 1:1.
 * See docs/specs/22-datasets.md §3.1 and docs/specs/00-overview.md §5 (three-channel parity).
 */
import { createDatasetImportSchema, datasetIdParamSchema, datasetImportBatchSchema } from '@proofhound/shared';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { DatasetImportService } from '../../modules/dataset/dataset-import.service';
import type { McpToolDefinition } from './mcp.types';

export function createDatasetImportTools(datasetImportService: DatasetImportService): McpToolDefinition[] {
  return [
    {
      name: 'dataset_import_create',
      description: '创建数据集导入会话（暂不创建数据集行）',
      inputSchema: {
        type: 'object',
        required: ['name', 'fieldMappings', 'sourceFile', 'sourceFormat'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          fieldMappings: { type: 'array' },
          sourceFile: { type: 'object' },
          sourceFormat: { type: 'string', enum: ['jsonl', 'csv', 'tsv', 'zip'] },
          declaredTotalRows: { type: 'integer' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const dto = createDatasetImportSchema.parse(input);
        return datasetImportService.createImport(projectId, dto, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_import_get',
      description: '读取导入会话状态与进度',
      inputSchema: {
        type: 'object',
        required: ['importId'],
        properties: {
          importId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const importId = datasetIdParamSchema.parse(input.importId);
        return datasetImportService.getImport(projectId, importId, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_import_append_batch',
      description: '向导入会话追加一批样本到暂存表',
      inputSchema: {
        type: 'object',
        required: ['importId', 'batchStartIndex', 'samples'],
        properties: {
          importId: { type: 'string', format: 'uuid' },
          batchStartIndex: { type: 'integer' },
          samples: { type: 'array' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const importId = datasetIdParamSchema.parse(input.importId);
        const dto = datasetImportBatchSchema.parse({
          batchStartIndex: input.batchStartIndex,
          samples: input.samples,
        });
        return datasetImportService.appendBatch(projectId, importId, dto, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_import_complete',
      description: '完成导入：提升暂存样本为正式数据集',
      inputSchema: {
        type: 'object',
        required: ['importId'],
        properties: {
          importId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const importId = datasetIdParamSchema.parse(input.importId);
        return datasetImportService.complete(projectId, importId, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_import_abort',
      description: '取消导入会话并清除已暂存样本',
      inputSchema: {
        type: 'object',
        required: ['importId'],
        properties: {
          importId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const importId = datasetIdParamSchema.parse(input.importId);
        await datasetImportService.abort(projectId, importId, getMcpActor(ctx));
        return { ok: true };
      },
    },
  ];
}
