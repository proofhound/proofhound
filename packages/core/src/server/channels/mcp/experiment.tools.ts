/**
 * MCP tool definitions for experiments.
 * Each tool delegates to ExperimentService, matching the REST surface 1:1.
 * See docs/specs/00-overview.md §5 (three-channel parity) + docs/specs/24-experiments.md.
 */
import { Buffer } from 'node:buffer';
import {
  createExperimentSchema,
  experimentControlActionSchema,
  experimentExportFormatSchema,
  experimentIdParamSchema,
  experimentListQuerySchema,
  runResultExportFormatSchema,
  runResultListQuerySchema,
} from '@proofhound/shared';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { ExperimentService } from '../../modules/experiment/experiment.service';
import type { McpToolDefinition } from './mcp.types';

export function createExperimentTools(experimentService: ExperimentService): McpToolDefinition[] {
  return [
    {
      name: 'experiment_create_experiment',
      description: '创建实验,提交后立即触发 DBOS workflow 派 LLM 任务',
      inputSchema: {
        type: 'object',
        required: ['name', 'promptVersionId', 'datasetId', 'modelId'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          promptVersionId: { type: 'string', format: 'uuid' },
          datasetId: { type: 'string', format: 'uuid' },
          modelId: { type: 'string', format: 'uuid' },
          runConfig: { type: 'object', additionalProperties: true },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const dto = createExperimentSchema.parse({
          name: input.name,
          promptVersionId: input.promptVersionId,
          datasetId: input.datasetId,
          modelId: input.modelId,
          runConfig: input.runConfig,
        });
        return experimentService.createExperiment(projectId, dto, getMcpActor(ctx), 'mcp', orgId);
      },
    },
    {
      name: 'experiment_list_experiments',
      description: '列出实验，支持状态过滤、搜索和指标排序',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['running', 'success', 'failed', 'stopped'] },
          search: { type: 'string' },
          sort: { type: 'string', enum: ['accuracy', 'updated', 'duration'] },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const query = experimentListQuerySchema.parse(input);
        return experimentService.listExperiments(projectId, getMcpActor(ctx), query);
      },
    },
    {
      name: 'experiment_get_experiment',
      description: '读取单个实验摘要',
      inputSchema: {
        type: 'object',
        required: ['experimentId'],
        properties: {
          experimentId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const experimentId = experimentIdParamSchema.parse(input.experimentId);
        return experimentService.getExperiment(projectId, experimentId, getMcpActor(ctx));
      },
    },
    {
      name: 'experiment_control_experiment',
      description: '控制实验状态：停止、恢复或重跑；cancel 作为旧客户端兼容别名按 stop 处理',
      inputSchema: {
        type: 'object',
        required: ['experimentId', 'action'],
        properties: {
          experimentId: { type: 'string', format: 'uuid' },
          action: { type: 'string', enum: ['stop', 'resume', 'cancel', 'retry'] },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const experimentId = experimentIdParamSchema.parse(input.experimentId);
        const action = experimentControlActionSchema.parse(input.action);
        return experimentService.controlExperiment(projectId, experimentId, action, getMcpActor(ctx), 'mcp', orgId);
      },
    },
    {
      name: 'experiment_export_experiments',
      description: '导出实验列表',
      inputSchema: {
        type: 'object',
        properties: {
          experimentId: { type: 'string', format: 'uuid' },
          format: { type: 'string', enum: ['csv', 'jsonl'] },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const experimentId =
          typeof input.experimentId === 'string' ? experimentIdParamSchema.parse(input.experimentId) : undefined;
        const format = experimentExportFormatSchema.parse(input.format ?? 'csv');
        const file = await experimentService.exportExperiments(projectId, format, getMcpActor(ctx), experimentId);

        return {
          fileName: file.fileName,
          contentType: file.contentType,
          byteLength: file.byteLength,
          format: file.format,
          contentBase64: file.buffer.toString('base64'),
        };
      },
    },
    {
      name: 'experiment_export_package',
      description: '导出单个实验的完整 ZIP 包：summary.csv + run-results.csv/jsonl',
      inputSchema: {
        type: 'object',
        required: ['experimentId'],
        properties: {
          experimentId: { type: 'string', format: 'uuid' },
          format: { type: 'string', enum: ['csv', 'jsonl'] },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 200 },
          status: { type: 'array', items: { type: 'string', enum: ['running', 'success', 'failed'] } },
          judgmentStatus: {
            type: 'array',
            items: { type: 'string', enum: ['correct', 'incorrect', 'parse_error', 'judge_error'] },
          },
          isCorrect: { type: 'boolean' },
          search: { type: 'string' },
          sort: { type: 'string', enum: ['created_desc', 'latency_desc', 'tokens_desc'] },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const experimentId = experimentIdParamSchema.parse(input.experimentId);
        const format = runResultExportFormatSchema.parse(input.format ?? 'csv');
        const query = runResultListQuerySchema.parse({
          page: input.page,
          pageSize: input.pageSize,
          status: input.status,
          judgmentStatus: input.judgmentStatus,
          isCorrect: input.isCorrect,
          search: input.search,
          sort: input.sort,
        });
        const file = await experimentService.exportExperimentPackage(
          projectId,
          experimentId,
          format,
          getMcpActor(ctx),
          query,
        );
        const buffer = await streamToBuffer(file.stream);

        return {
          fileName: file.fileName,
          contentType: file.contentType,
          byteLength: buffer.byteLength,
          format: file.detailFormat,
          contentBase64: buffer.toString('base64'),
        };
      },
    },
    {
      name: 'experiment_delete_experiment',
      description: '物理删除实验；不会写 deleted_at 软删标记',
      inputSchema: {
        type: 'object',
        required: ['experimentId'],
        properties: {
          experimentId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const experimentId = experimentIdParamSchema.parse(input.experimentId);
        await experimentService.deleteExperiment(projectId, experimentId, getMcpActor(ctx), 'mcp');
        return { ok: true };
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
