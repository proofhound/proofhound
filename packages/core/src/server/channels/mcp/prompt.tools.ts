/**
 * MCP tool definitions for the prompt domain.
 * Each tool delegates to PromptService, matching the REST surface 1:1.
 */
import {
  createPromptDraftVersionSchema,
  createPromptSchema,
  promptIdParamSchema,
  promptTryRunRequestSchema,
  promptVersionIdParamSchema,
  updatePromptDraftVersionSchema,
  updatePromptVersionLabelSchema,
  updatePromptSchema,
} from '@proofhound/shared';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { PromptTryRunService } from '../../modules/prompt/prompt-try-run.service';
import type { PromptService } from '../../modules/prompt/prompt.service';
import type { McpToolDefinition } from './mcp.types';

export function createPromptTools(
  promptService: PromptService,
  promptTryRunService: PromptTryRunService,
): McpToolDefinition[] {
  return [
    {
      name: 'prompt_list_prompts',
      description: '列出提示词',
      inputSchema: { type: 'object', properties: {} },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        return promptService.listPrompts(projectId, getMcpActor(ctx));
      },
    },
    {
      name: 'prompt_get_prompt',
      description: '读取提示词及版本详情',
      inputSchema: {
        type: 'object',
        required: ['promptId'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(input.promptId);
        return promptService.getPrompt(projectId, promptId, getMcpActor(ctx));
      },
    },
    {
      name: 'prompt_get_prompt_metrics',
      description: '按提示词版本聚合运行指标',
      inputSchema: {
        type: 'object',
        required: ['promptId'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(input.promptId);
        return promptService.getPromptMetrics(projectId, promptId, getMcpActor(ctx));
      },
    },
    {
      name: 'prompt_create_prompt',
      description: '创建提示词和初始可编辑版本',
      inputSchema: {
        type: 'object',
        required: ['name', 'defaultDatasetId'],
        properties: {
          name: { type: 'string' },
          defaultDatasetId: { type: 'string', format: 'uuid' },
          promptLanguage: { type: 'string', enum: ['zh-CN', 'en-US'] },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const dto = createPromptSchema.parse(input);
        return promptService.createPrompt(projectId, dto, getMcpActor(ctx));
      },
    },
    {
      name: 'prompt_update_prompt',
      description: '更新提示词外壳设置（如默认绑定数据集）',
      inputSchema: {
        type: 'object',
        required: ['promptId', 'defaultDatasetId'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
          defaultDatasetId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { promptId: rawPromptId, ...rawDto } = input;
        const { projectId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(rawPromptId);
        const dto = updatePromptSchema.parse(rawDto);
        return promptService.updatePrompt(projectId, promptId, dto, getMcpActor(ctx));
      },
    },
    {
      name: 'prompt_update_version_label',
      description: '移动或删除提示词版本 label；versionId 为 null 时删除 label，latest 由系统管理不可移动',
      inputSchema: {
        type: 'object',
        required: ['promptId', 'label', 'versionId'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
          label: { type: 'string' },
          versionId: { type: ['string', 'null'], format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { promptId: rawPromptId, ...rawDto } = input;
        const { projectId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(rawPromptId);
        const dto = updatePromptVersionLabelSchema.parse(rawDto);
        return promptService.updateVersionLabel(projectId, promptId, dto, getMcpActor(ctx));
      },
    },
    {
      name: 'prompt_update_draft_version',
      description: '更新未冻结提示词版本执行契约',
      inputSchema: {
        type: 'object',
        required: ['promptId', 'versionId', 'body', 'variables', 'outputSchema', 'judgmentRules'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
          versionId: { type: 'string', format: 'uuid' },
          body: { type: 'string' },
          variables: { type: 'array' },
          outputSchema: { type: ['object', 'null'] },
          judgmentRules: { type: ['object', 'null'] },
          promptLanguage: { type: 'string', enum: ['zh-CN', 'en-US'] },
          changeReason: { type: ['string', 'null'] },
        },
      },
      handler: async (input, ctx) => {
        const { promptId: rawPromptId, versionId: rawVersionId, ...rawDto } = input;
        const { projectId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(rawPromptId);
        const versionId = promptVersionIdParamSchema.parse(rawVersionId);
        const dto = updatePromptDraftVersionSchema.parse(rawDto);
        return promptService.updateDraftVersion(projectId, promptId, versionId, dto, getMcpActor(ctx));
      },
    },
    {
      name: 'prompt_delete_prompt',
      description: '物理删除提示词；删除前应先调用 prompt_get_delete_impact 展示受影响对象',
      inputSchema: {
        type: 'object',
        required: ['promptId'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(input.promptId);
        await promptService.deletePrompt(projectId, promptId, getMcpActor(ctx));
        return { ok: true };
      },
    },
    {
      name: 'prompt_get_delete_impact',
      description: '查看删除提示词会影响的实验、优化、灰度发布与正式发布',
      inputSchema: {
        type: 'object',
        required: ['promptId'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(input.promptId);
        return promptService.getPromptDeleteImpact(projectId, promptId, getMcpActor(ctx));
      },
    },
    {
      name: 'prompt_get_version_delete_impact',
      description: '查看删除提示词版本会影响的实验、优化、灰度发布与正式发布',
      inputSchema: {
        type: 'object',
        required: ['promptId', 'versionId'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
          versionId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(input.promptId);
        const versionId = promptVersionIdParamSchema.parse(input.versionId);
        return promptService.getPromptVersionDeleteImpact(projectId, promptId, versionId, getMcpActor(ctx));
      },
    },
    {
      name: 'prompt_create_draft_version',
      description: '创建空白可编辑提示词版本；传 sourceVersionId 时基于已有版本复制派生',
      inputSchema: {
        type: 'object',
        required: ['promptId'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
          sourceVersionId: { type: 'string', format: 'uuid' },
          changeReason: { type: 'string' },
        },
      },
      handler: async (input, ctx) => {
        const { promptId: rawPromptId, ...rawDto } = input;
        const { projectId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(rawPromptId);
        const dto = createPromptDraftVersionSchema.parse(rawDto);
        return promptService.createDraftVersion(projectId, promptId, dto, getMcpActor(ctx));
      },
    },
    {
      name: 'prompt_try_run',
      description: '对指定提示词版本 + 模型同步执行一次 LLM 调用，不写运行结果表',
      inputSchema: {
        type: 'object',
        required: ['promptId', 'promptVersionId', 'modelId'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
          promptVersionId: { type: 'string', format: 'uuid' },
          modelId: { type: 'string', format: 'uuid' },
          variables: { type: 'object', additionalProperties: true },
          temperature: { type: 'number' },
          maxTokens: { type: 'integer' },
          timeoutSeconds: { type: 'integer' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(input.promptId);
        const dto = promptTryRunRequestSchema.parse({
          promptVersionId: input.promptVersionId,
          modelId: input.modelId,
          variables: input.variables ?? {},
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          timeoutSeconds: input.timeoutSeconds,
        });
        return promptTryRunService.tryRun(projectId, promptId, dto, getMcpActor(ctx), orgId);
      },
    },
    {
      name: 'prompt_delete_draft_version',
      description: '物理删除提示词版本；删除前应先调用 prompt_get_version_delete_impact 展示受影响对象',
      inputSchema: {
        type: 'object',
        required: ['promptId', 'versionId'],
        properties: {
          promptId: { type: 'string', format: 'uuid' },
          versionId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const promptId = promptIdParamSchema.parse(input.promptId);
        const versionId = promptVersionIdParamSchema.parse(input.versionId);
        await promptService.deleteDraftVersion(projectId, promptId, versionId, getMcpActor(ctx));
        return { ok: true };
      },
    },
  ];
}
