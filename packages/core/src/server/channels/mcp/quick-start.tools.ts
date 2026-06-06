/**
 * MCP tool definitions for the quick-start aggregate flow.
 * This preserves SPEC 00 §5 channel parity for the non-project onboarding path.
 */
import { createQuickStartSchema, modelIdParamSchema, probeQuickStartDraftModelSchema } from '@proofhound/shared';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { QuickStartService } from '../../modules/quick-start/quick-start.service';
import type { McpToolDefinition } from './mcp.types';

export function createQuickStartTools(service: QuickStartService): McpToolDefinition[] {
  return [
    {
      name: 'quick_start_list_model_options',
      description: '列出快速开始可直接用于新项目的已有全局模型',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input, ctx) => service.listModelOptions(getMcpActor(ctx)),
    },
    {
      name: 'quick_start_probe_existing_model',
      description: '对快速开始中选择的已有全局模型发起连通性测试',
      inputSchema: {
        type: 'object',
        required: ['modelId'],
        properties: { modelId: { type: 'string', format: 'uuid' } },
      },
      handler: async (input, ctx) =>
        service.probeExistingModel(modelIdParamSchema.parse(input.modelId), getMcpActor(ctx), 'mcp'),
    },
    {
      name: 'quick_start_probe_draft_model',
      description: '对快速开始页面中尚未保存的新模型草稿发起连通性测试',
      inputSchema: { type: 'object', properties: {} },
      handler: async (input, ctx) => {
        const dto = probeQuickStartDraftModelSchema.parse(input);
        return service.probeDraftModel(dto, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'quick_start_create',
      description: '执行快速开始：创建项目、数据集、模型引用与优化任务',
      inputSchema: { type: 'object', properties: {} },
      handler: async (input, ctx) => {
        const dto = createQuickStartSchema.parse(input);
        return service.createQuickStart(dto, resolveMcpProjectContext(ctx), getMcpActor(ctx), 'mcp');
      },
    },
  ];
}
