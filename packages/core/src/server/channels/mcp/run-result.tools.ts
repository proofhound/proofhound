/**
 * MCP tool definitions for the run-result domain.
 * Each tool delegates to RunResultService, matching the REST surface 1:1.
 * See docs/specs/00-overview.md §5 (three-channel parity).
 */
import { Buffer } from 'node:buffer';
import {
  experimentIdParamSchema,
  releaseRunResultCleanupFilterSchema,
  releaseRunResultCleanupInputSchema,
  runResultExportFormatSchema,
  runResultListQuerySchema,
  runResultReleaseListQuerySchema,
} from '@proofhound/shared';
import { z } from 'zod';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { RunResultService } from '../../modules/run-result/run-result.service';
import type { McpToolDefinition } from './mcp.types';

const runResultIdParamSchema = z.string().uuid();

export function createRunResultTools(runResultService: RunResultService): McpToolDefinition[] {
  return [
    {
      name: 'run_result_list_for_experiment',
      description:
        '按实验查询运行结果列表（分页 / 按 status / judgmentStatus / isCorrect / search 过滤，含输入变量与模型输出预览字段）',
      inputSchema: {
        type: 'object',
        required: ['experimentId'],
        properties: {
          experimentId: { type: 'string', format: 'uuid' },
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
        const query = runResultListQuerySchema.parse({
          page: input.page,
          pageSize: input.pageSize,
          status: input.status,
          judgmentStatus: input.judgmentStatus,
          isCorrect: input.isCorrect,
          search: input.search,
          sort: input.sort,
        });
        return runResultService.listExperimentRunResults(projectId, experimentId, getMcpActor(ctx), query);
      },
    },
    {
      name: 'run_result_export_for_experiment',
      description: '导出单个实验的运行结果文件（CSV / JSONL，复用列表过滤条件但导出全部匹配行）',
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
        const file = await runResultService.exportExperimentRunResults(
          projectId,
          experimentId,
          getMcpActor(ctx),
          format,
          query,
        );
        const buffer = await streamToBuffer(file.stream);
        return {
          fileName: file.fileName,
          contentType: file.contentType,
          byteLength: buffer.byteLength,
          format,
          contentBase64: buffer.toString('base64'),
        };
      },
    },
    {
      name: 'run_result_get',
      description: '读取单个运行结果详情（含 raw_response / parsed_output / rendered_prompt 等大字段）',
      inputSchema: {
        type: 'object',
        required: ['experimentId', 'runResultId'],
        properties: {
          experimentId: { type: 'string', format: 'uuid' },
          runResultId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const experimentId = experimentIdParamSchema.parse(input.experimentId);
        const runResultId = runResultIdParamSchema.parse(input.runResultId);
        return runResultService.getExperimentRunResult(projectId, experimentId, runResultId, getMcpActor(ctx));
      },
    },
    {
      name: 'run_result_list_for_release',
      description:
        '按发布维度查询运行结果列表（production / canary lane，支持发布版本 / sourceIds / promptVersionIds / externalId / 状态 / 时间窗过滤）',
      inputSchema: {
        type: 'object',
        properties: {
          sourceIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          releaseVersionIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          releaseVersionScope: { type: 'string', enum: ['exact', 'journey'] },
          promptVersionIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          lane: { type: 'array', items: { type: 'string', enum: ['production', 'canary'] } },
          externalId: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
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
        const query = runResultReleaseListQuerySchema.parse({
          sourceIds: input.sourceIds,
          releaseVersionIds: input.releaseVersionIds,
          releaseVersionScope: input.releaseVersionScope,
          promptVersionIds: input.promptVersionIds,
          lane: input.lane,
          externalId: input.externalId,
          from: input.from,
          to: input.to,
          page: input.page,
          pageSize: input.pageSize,
          status: input.status,
          judgmentStatus: input.judgmentStatus,
          isCorrect: input.isCorrect,
          search: input.search,
          sort: input.sort,
        });
        return runResultService.listReleaseRunResults(projectId, getMcpActor(ctx), query);
      },
    },
    {
      name: 'run_result_export_for_release',
      description: '按发布维度导出运行结果文件（CSV / JSONL，复用 release 列表过滤条件但导出全部匹配行）',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['csv', 'jsonl'] },
          sourceIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          releaseVersionIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          releaseVersionScope: { type: 'string', enum: ['exact', 'journey'] },
          promptVersionIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          lane: { type: 'array', items: { type: 'string', enum: ['production', 'canary'] } },
          externalId: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
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
        const format = runResultExportFormatSchema.parse(input.format ?? 'csv');
        const query = runResultReleaseListQuerySchema.parse({
          sourceIds: input.sourceIds,
          releaseVersionIds: input.releaseVersionIds,
          releaseVersionScope: input.releaseVersionScope,
          promptVersionIds: input.promptVersionIds,
          lane: input.lane,
          externalId: input.externalId,
          from: input.from,
          to: input.to,
          page: input.page,
          pageSize: input.pageSize,
          status: input.status,
          judgmentStatus: input.judgmentStatus,
          isCorrect: input.isCorrect,
          search: input.search,
          sort: input.sort,
        });
        const file = await runResultService.exportReleaseRunResults(projectId, getMcpActor(ctx), format, query);
        const buffer = await streamToBuffer(file.stream);
        return {
          fileName: file.fileName,
          contentType: file.contentType,
          byteLength: buffer.byteLength,
          format,
          contentBase64: buffer.toString('base64'),
        };
      },
    },
    {
      name: 'run_result_cleanup_release_preview',
      description:
        '预估按发布版本清理运行结果的影响（必须传 releaseVersionIds；返回匹配行数、annotation 数、可立即回收与共享延迟回收的对象存储字节）',
      inputSchema: releaseCleanupToolInputSchema(false),
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const filter = releaseRunResultCleanupFilterSchema.parse(input);
        return runResultService.previewReleaseRunResultCleanup(projectId, getMcpActor(ctx), filter);
      },
    },
    {
      name: 'run_result_cleanup_release',
      description:
        '删除按发布版本匹配的运行结果（必须传 releaseVersionIds 与 confirmation=delete_release_run_results；会先删 annotations，再删 run_results，并清理不再引用的 shard 对象）',
      inputSchema: releaseCleanupToolInputSchema(true),
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const body = releaseRunResultCleanupInputSchema.parse(input);
        return runResultService.cleanupReleaseRunResults(projectId, getMcpActor(ctx), body);
      },
    },
  ];
}

function releaseCleanupToolInputSchema(requireConfirmation: boolean) {
  return {
    type: 'object',
    required: requireConfirmation ? ['releaseVersionIds', 'confirmation'] : ['releaseVersionIds'],
    properties: {
      sourceIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
      releaseVersionIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
      releaseVersionScope: { type: 'string', enum: ['exact', 'journey'] },
      promptVersionIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
      lane: { type: 'array', items: { type: 'string', enum: ['production', 'canary'] } },
      externalId: { type: 'string' },
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      status: { type: 'array', items: { type: 'string', enum: ['running', 'success', 'failed'] } },
      judgmentStatus: {
        type: 'array',
        items: { type: 'string', enum: ['correct', 'incorrect', 'parse_error', 'judge_error'] },
      },
      isCorrect: { type: 'boolean' },
      search: { type: 'string' },
      ...(requireConfirmation ? { confirmation: { type: 'string', enum: ['delete_release_run_results'] } } : {}),
    },
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}
