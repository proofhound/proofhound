/**
 * MCP tool definitions for optimizations.
 * Each tool delegates to OptimizationService, matching the REST surface 1:1.
 * See docs/specs/00-overview.md §5 (three-channel parity) + docs/specs/25-optimizations.md.
 */
import {
  optimizationControlActionSchema,
  optimizationIdParamSchema,
  optimizationListQuerySchema,
  createOptimizationSchema,
} from '@proofhound/shared';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { OptimizationService } from '../../modules/optimization/optimization.service';
import type { McpToolDefinition } from './mcp.types';

export function createOptimizationTools(optimizationService: OptimizationService): McpToolDefinition[] {
  return [
    {
      name: 'optimization_list',
      description: '列出优化任务，支持状态过滤、搜索和指标排序',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['running', 'success', 'failed', 'stopped', 'cancelled'] },
          search: { type: 'string' },
          sort: { type: 'string', enum: ['updated', 'bestMetric', 'round'] },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const query = optimizationListQuerySchema.parse(input);
        return optimizationService.listOptimizations(projectId, getMcpActor(ctx), query);
      },
    },
    {
      name: 'optimization_get',
      description:
        '读取单个优化任务详情。rounds[i].steps 反映每轮 error_analysis / generate_prompt / experiment 三步实时状态(running/success/failed/skipped),即便 experiments 行尚未创建也能拿到当前轮卡片与失败原因。',
      inputSchema: {
        type: 'object',
        required: ['optimizationId'],
        properties: {
          optimizationId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const optimizationId = optimizationIdParamSchema.parse(input.optimizationId);
        return optimizationService.getOptimization(projectId, optimizationId, getMcpActor(ctx));
      },
    },
    {
      name: 'optimization_create',
      description:
        '新建优化任务并立即进入 running。`startingMode` 三选一:\n' +
        '- `from_experiment`: 传 `sourceExperimentId`,server 自动解析 promptId / baseVersionId\n' +
        '- `from_prompt_version`: 传 `promptId`,baseVersionId 留空则 server 自动选最新可用版本\n' +
        '- `from_dataset_only` (SPEC 25 §2.1): 仅传 `datasetId` + `analysisModelId` + `experimentModelId` + `goals`,**不要**传 `promptId` / `baseVersionId`。server 自动建一个空 prompt,workflow 用 analysisModel 从数据集采样生成首版后回填 base_version_id。\n' +
        '- 可选 `promptLanguage`: `zh-CN` 或 `en-US`,控制本任务平台生成的提示词语言；未传时继承基线版本或默认 `zh-CN`。\n' +
        '- 可选 `optimizationHint`: 提示词生成指引,只进入首版/每轮 generate_prompt,不进入错误分析或 summarize。',
      inputSchema: {
        type: 'object',
        required: ['body'],
        properties: {
          body: { type: 'object' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const body = createOptimizationSchema.parse(input.body);
        return optimizationService.createOptimization(projectId, body, getMcpActor(ctx), 'mcp', orgId);
      },
    },
    {
      name: 'optimization_control',
      description: '控制优化状态：停止、恢复、取消',
      inputSchema: {
        type: 'object',
        required: ['optimizationId', 'action'],
        properties: {
          optimizationId: { type: 'string', format: 'uuid' },
          action: { type: 'string', enum: ['stop', 'resume', 'cancel'] },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const optimizationId = optimizationIdParamSchema.parse(input.optimizationId);
        const action = optimizationControlActionSchema.parse(input.action);
        return optimizationService.controlOptimization(projectId, optimizationId, action, getMcpActor(ctx), 'mcp', orgId);
      },
    },
    {
      name: 'optimization_delete',
      description: '物理删除优化任务；不会写 deleted_at 软删标记',
      inputSchema: {
        type: 'object',
        required: ['optimizationId'],
        properties: {
          optimizationId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const optimizationId = optimizationIdParamSchema.parse(input.optimizationId);
        await optimizationService.deleteOptimization(projectId, optimizationId, getMcpActor(ctx), 'mcp');
        return { ok: true };
      },
    },
  ];
}
