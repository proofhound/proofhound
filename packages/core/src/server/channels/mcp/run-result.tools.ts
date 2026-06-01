/**
 * MCP tool definitions for the run-result domain.
 * Each tool delegates to RunResultService, matching the REST surface 1:1.
 * See docs/specs/00-overview.md §5 (three-channel parity).
 */
import { experimentIdParamSchema, runResultListQuerySchema, runResultReleaseListQuerySchema } from '@proofhound/shared';
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
          status: { type: 'array', items: { type: 'string', enum: ['success', 'error', 'timeout', 'rate_limited'] } },
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
        '按发布维度查询运行结果列表（production / canary lane，支持发布组合 / sourceIds / promptVersionIds / externalId / 状态 / 时间窗过滤）',
      inputSchema: {
        type: 'object',
        properties: {
          sourceIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          releaseVariantIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          promptVersionIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          lane: { type: 'array', items: { type: 'string', enum: ['production', 'canary'] } },
          externalId: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 200 },
          status: { type: 'array', items: { type: 'string', enum: ['success', 'error', 'timeout', 'rate_limited'] } },
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
          releaseVariantIds: input.releaseVariantIds,
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
  ];
}
