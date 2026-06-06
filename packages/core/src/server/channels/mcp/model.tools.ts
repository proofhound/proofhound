/**
 * MCP tool definitions for the model domain.
 * Each tool delegates to ModelService, matching the REST surface 1:1.
 * See docs/specs/00-overview.md §5 (three-channel parity).
 */
import {
  createProjectModelSchema,
  listModelContextWindowsQuerySchema,
  lookupModelContextWindowQuerySchema,
  modelDeleteQuerySchema,
  modelIdParamSchema,
  probeDraftProjectModelSchema,
  updateProjectModelSchema,
  upsertModelContextWindowSchema,
} from '@proofhound/shared';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { ModelService } from '../../modules/model/model.service';
import type { McpToolDefinition } from './mcp.types';

export function createModelTools(modelService: ModelService): McpToolDefinition[] {
  return [
    // -----------------------------------------------------------------------
    // Model context dictionary
    // -----------------------------------------------------------------------
    {
      name: 'model_list_context_windows',
      description: '列出模型上下文字典条目',
      inputSchema: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      },
      handler: async (input) => {
        const query = listModelContextWindowsQuerySchema.parse(input);
        return modelService.listContextWindows(query);
      },
    },
    {
      name: 'model_lookup_context_window',
      description: '按厂商模型 ID 查询默认上下文长度',
      inputSchema: {
        type: 'object',
        required: ['providerModelId'],
        properties: {
          providerModelId: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
      handler: async (input) => {
        const query = lookupModelContextWindowQuerySchema.parse(input);
        return modelService.lookupContextWindow(query.providerModelId);
      },
    },
    {
      name: 'model_upsert_context_window',
      description: '新增或更新模型上下文字典条目',
      inputSchema: {
        type: 'object',
        required: ['providerModelId', 'contextWindowTokens'],
        properties: {
          providerModelId: { type: 'string', minLength: 1, maxLength: 200 },
          contextWindowTokens: { type: 'integer', minimum: 1 },
        },
      },
      handler: async (input, ctx) => {
        const dto = upsertModelContextWindowSchema.parse(input);
        return modelService.upsertContextWindow(dto, ctx.actorUserId, 'mcp');
      },
    },
    {
      name: 'model_list_models',
      description: '列出本地模型',
      inputSchema: { type: 'object', properties: {} },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        return modelService.listProjectModels(projectId, getMcpActor(ctx), orgId);
      },
    },
    {
      name: 'model_get_model',
      description: '读取模型详情',
      inputSchema: {
        type: 'object',
        required: ['modelId'],
        properties: {
          modelId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        return modelService.getProjectModelDetail(
          projectId,
          modelIdParamSchema.parse(input.modelId),
          getMcpActor(ctx),
          orgId,
        );
      },
    },
    {
      name: 'model_create_model',
      description: '创建模型',
      inputSchema: { type: 'object', properties: {} },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const dto = createProjectModelSchema.parse(input);
        return modelService.createProjectModel(projectId, dto, getMcpActor(ctx), 'mcp', orgId);
      },
    },
    {
      name: 'model_probe_draft_model',
      description: '对尚未保存的模型草稿发起连通性测试',
      inputSchema: { type: 'object', properties: {} },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const dto = probeDraftProjectModelSchema.parse(input);
        return modelService.probeDraftProjectModel(projectId, dto, getMcpActor(ctx), 'mcp', orgId);
      },
    },
    {
      name: 'model_update_model',
      description: '更新模型',
      inputSchema: {
        type: 'object',
        required: ['modelId'],
        properties: {
          modelId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { modelId: rawModelId, ...rest } = input;
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const modelId = modelIdParamSchema.parse(rawModelId);
        const dto = updateProjectModelSchema.parse(rest);
        return modelService.updateProjectModel(projectId, modelId, dto, getMcpActor(ctx), 'mcp', orgId);
      },
    },
    {
      name: 'model_delete_model',
      description: '删除模型',
      inputSchema: {
        type: 'object',
        required: ['modelId'],
        properties: {
          modelId: { type: 'string', format: 'uuid' },
          force: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const modelId = modelIdParamSchema.parse(input.modelId);
        const query = modelDeleteQuerySchema.parse({ force: input.force, reason: input.reason });
        await modelService.deleteProjectModel(projectId, modelId, query, getMcpActor(ctx), 'mcp');
        return { ok: true };
      },
    },
    {
      name: 'model_duplicate_model',
      description: '基于已有模型复制出副本',
      inputSchema: {
        type: 'object',
        required: ['modelId'],
        properties: {
          modelId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        return modelService.duplicateProjectModel(
          projectId,
          modelIdParamSchema.parse(input.modelId),
          getMcpActor(ctx),
          'mcp',
          orgId,
        );
      },
    },
    {
      name: 'model_probe_model',
      description: '对模型发起连通性测试',
      inputSchema: {
        type: 'object',
        required: ['modelId'],
        properties: {
          modelId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        return modelService.probeProjectModel(
          projectId,
          modelIdParamSchema.parse(input.modelId),
          getMcpActor(ctx),
          'mcp',
          orgId,
        );
      },
    },
    {
      name: 'model_reveal_api_key',
      description: '查看模型 API Key 明文',
      inputSchema: {
        type: 'object',
        required: ['modelId'],
        properties: {
          modelId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) =>
        modelService.revealProjectApiKey(
          resolveMcpProjectContext(ctx).projectId,
          modelIdParamSchema.parse(input.modelId),
          getMcpActor(ctx),
          'mcp',
        ),
    },
    {
      name: 'model_get_references',
      description: '获取模型的在线引用统计',
      inputSchema: {
        type: 'object',
        required: ['modelId'],
        properties: {
          modelId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) =>
        modelService.getProjectModelReferences(
          resolveMcpProjectContext(ctx).projectId,
          modelIdParamSchema.parse(input.modelId),
          getMcpActor(ctx),
        ),
    },
    {
      name: 'model_export_models',
      description: '导出模型 CSV',
      inputSchema: { type: 'object', properties: {} },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const file = await modelService.exportProjectModelsCsv(projectId, getMcpActor(ctx), orgId);
        return {
          fileName: file.fileName,
          contentType: file.contentType,
          byteLength: file.byteLength,
          contentBase64: file.buffer.toString('base64'),
        };
      },
    },
  ];
}
