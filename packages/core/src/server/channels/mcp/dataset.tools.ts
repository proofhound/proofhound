/**
 * MCP tool definitions for the dataset domain.
 * Each tool delegates to DatasetService, matching the REST surface 1:1.
 * See docs/specs/00-overview.md §5 (three-channel parity).
 */
import { Buffer } from 'node:buffer';
import {
  createDatasetSchema,
  datasetExportFormatSchema,
  datasetIdParamSchema,
  datasetSamplesQuerySchema,
  deleteDatasetSamplesSchema,
  updateDatasetMetadataSchema,
} from '@proofhound/shared';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { DatasetService } from '../../modules/dataset/dataset.service';
import type { McpToolDefinition } from './mcp.types';

export function createDatasetTools(datasetService: DatasetService): McpToolDefinition[] {
  return [
    {
      name: 'dataset_list_datasets',
      description: '列出数据集',
      inputSchema: { type: 'object', properties: {} },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        return datasetService.listDatasets(projectId, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_get_dataset',
      description: '读取单个数据集详情',
      inputSchema: {
        type: 'object',
        required: ['datasetId'],
        properties: {
          datasetId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const datasetId = datasetIdParamSchema.parse(input.datasetId);
        return datasetService.getDataset(projectId, datasetId, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_list_samples',
      description: '分页列出数据集样本（可选跨字段搜索）',
      inputSchema: {
        type: 'object',
        required: ['datasetId'],
        properties: {
          datasetId: { type: 'string', format: 'uuid' },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 200 },
          search: { type: 'string' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const datasetId = datasetIdParamSchema.parse(input.datasetId);
        const query = datasetSamplesQuerySchema.parse({
          page: input.page,
          pageSize: input.pageSize,
          search: input.search,
        });
        return datasetService.listDatasetSamples(projectId, datasetId, getMcpActor(ctx), query);
      },
    },
    {
      name: 'dataset_export_dataset',
      description: '导出数据集样本文件',
      inputSchema: {
        type: 'object',
        required: ['datasetId'],
        properties: {
          datasetId: { type: 'string', format: 'uuid' },
          format: { type: 'string', enum: ['csv', 'jsonl'] },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const datasetId = datasetIdParamSchema.parse(input.datasetId);
        const format = datasetExportFormatSchema.parse(input.format ?? 'csv');
        const file = await datasetService.exportDataset(projectId, datasetId, format, getMcpActor(ctx));
        const buffer = await streamToBuffer(file.createStream());

        return {
          fileName: file.fileName,
          contentType: file.contentType,
          byteLength: buffer.byteLength,
          format: file.format,
          contentBase64: buffer.toString('base64'),
        };
      },
    },
    {
      name: 'dataset_create_dataset',
      description: '创建数据集并写入样本',
      inputSchema: {
        type: 'object',
        required: ['name', 'uploadSource', 'fieldMappings', 'samples'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          uploadSource: { type: 'object' },
          fieldMappings: { type: 'array' },
          samples: { type: 'array' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const dto = createDatasetSchema.parse(input);
        return datasetService.createDataset(projectId, dto, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_delete_dataset',
      description: '物理删除数据集；删除前应先调用 dataset_get_delete_impact 展示会连带删除的实验 / 优化',
      inputSchema: {
        type: 'object',
        required: ['datasetId'],
        properties: {
          datasetId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const datasetId = datasetIdParamSchema.parse(input.datasetId);
        await datasetService.deleteDataset(projectId, datasetId, getMcpActor(ctx));
        return { ok: true };
      },
    },
    {
      name: 'dataset_get_delete_impact',
      description: '查看删除数据集会连带删除的实验与优化',
      inputSchema: {
        type: 'object',
        required: ['datasetId'],
        properties: {
          datasetId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const datasetId = datasetIdParamSchema.parse(input.datasetId);
        return datasetService.getDatasetDeleteImpact(projectId, datasetId, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_archive_dataset',
      description: '将数据集从活跃状态归档；归档后不能继续创建实验或优化',
      inputSchema: {
        type: 'object',
        required: ['datasetId'],
        properties: {
          datasetId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const datasetId = datasetIdParamSchema.parse(input.datasetId);
        return datasetService.archiveDataset(projectId, datasetId, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_restore_dataset',
      description: '将归档数据集恢复为活跃状态',
      inputSchema: {
        type: 'object',
        required: ['datasetId'],
        properties: {
          datasetId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const datasetId = datasetIdParamSchema.parse(input.datasetId);
        return datasetService.restoreDataset(projectId, datasetId, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_update_metadata',
      description: '更新数据集名称、描述与字段角色',
      inputSchema: {
        type: 'object',
        required: ['datasetId', 'name'],
        properties: {
          datasetId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string' },
          fieldMappings: { type: 'array' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const datasetId = datasetIdParamSchema.parse(input.datasetId);
        const dto = updateDatasetMetadataSchema.parse({
          name: input.name,
          description: input.description,
          fieldMappings: input.fieldMappings,
        });
        return datasetService.updateDatasetMetadata(projectId, datasetId, dto, getMcpActor(ctx));
      },
    },
    {
      name: 'dataset_delete_samples',
      description: '从数据集物理删除若干样本；被实验或优化引用时拒绝删除',
      inputSchema: {
        type: 'object',
        required: ['datasetId', 'sampleIds'],
        properties: {
          datasetId: { type: 'string', format: 'uuid' },
          sampleIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const datasetId = datasetIdParamSchema.parse(input.datasetId);
        const dto = deleteDatasetSamplesSchema.parse({ sampleIds: input.sampleIds });
        return datasetService.deleteDatasetSamples(projectId, datasetId, dto, getMcpActor(ctx));
      },
    },
  ];
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}
