/**
 * MCP tool definitions for canary releases.
 * Each tool delegates to CanaryReleaseService, matching the REST surface 1:1.
 * See docs/specs/00-overview.md §5 (three-channel parity) + docs/specs/27-releases.md.
 */
import {
  cancelCanaryReleaseInputSchema,
  claimCanaryAnnotationsInputSchema,
  createCanaryReleaseInputSchema,
  releaseCanaryAnnotationInputSchema,
  resumeCanaryReleaseInputSchema,
  stopCanaryReleaseInputSchema,
  submitCanaryAnnotationInputSchema,
  updateCanaryTrafficRatioInputSchema,
} from '@proofhound/shared';
import { z } from 'zod';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { CanaryReleaseService } from '../../modules/canary-release/canary-release.service';
import type { McpToolDefinition } from './mcp.types';

const uuidParam = z.string().uuid();

export function createCanaryReleaseTools(service: CanaryReleaseService): McpToolDefinition[] {
  return [
    {
      name: 'canary_release_list',
      description: '列出所有灰度发布及标注进度',
      inputSchema: { type: 'object', properties: {} },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        return service.list(projectId, getMcpActor(ctx));
      },
    },
    {
      name: 'canary_release_get',
      description: '读取单个灰度发布详情',
      inputSchema: {
        type: 'object',
        required: ['canaryId'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        return service.getDetail(projectId, canaryId, getMcpActor(ctx));
      },
    },
    {
      name: 'canary_release_create',
      description: '新建灰度发布；提交后直接进入 running',
      inputSchema: {
        type: 'object',
        required: [
          'promptVersionId',
          'modelId',
          'inputConnectorId',
          'trafficRatio',
          'runMode',
          'variableMapping',
          'externalIdField',
          'runConfig',
        ],
        properties: {
          name: { type: ['string', 'null'], minLength: 1, maxLength: 120 },
          description: { type: ['string', 'null'], maxLength: 500 },
          promptVersionId: { type: 'string', format: 'uuid' },
          modelId: { type: 'string', format: 'uuid' },
          inputConnectorId: { type: 'string', format: 'uuid' },
          outputConnectorIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          trafficRatio: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
          trafficMode: { type: 'string', enum: ['split', 'dual_run'] },
          runMode: { type: 'string', enum: ['fixed_duration', 'manual'] },
          recordMode: { type: 'string', enum: ['all', 'correct_only'] },
          variableMapping: { type: 'array', items: { type: 'object' } },
          outputMapping: { type: 'array', items: { type: 'object' } },
          filterRules: {},
          stopConditions: { type: 'object' },
          externalIdField: { type: 'string', minLength: 1 },
          annotationSchema: { type: 'array', items: { type: 'object' } },
          storageCategories: { type: 'array', items: { type: 'string' } },
          targetDatasetId: { type: 'string', format: 'uuid' },
          runConfig: { type: 'object' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const dto = createCanaryReleaseInputSchema.parse(input);
        return service.create(projectId, dto, getMcpActor(ctx), orgId);
      },
    },
    {
      name: 'canary_release_start',
      description: '兼容旧数据：将历史 pending 灰度发布转为 running',
      inputSchema: {
        type: 'object',
        required: ['canaryId'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        return service.start(projectId, canaryId, getMcpActor(ctx), orgId);
      },
    },
    {
      name: 'canary_release_stop',
      description: '停止 running 灰度发布',
      inputSchema: {
        type: 'object',
        required: ['canaryId'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        stopCanaryReleaseInputSchema.parse({});
        return service.stop(projectId, canaryId, getMcpActor(ctx));
      },
    },
    {
      name: 'canary_release_resume',
      description: '将 stopped 灰度发布恢复为 running',
      inputSchema: {
        type: 'object',
        required: ['canaryId'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        resumeCanaryReleaseInputSchema.parse({});
        return service.resume(projectId, canaryId, getMcpActor(ctx), orgId);
      },
    },
    {
      name: 'canary_release_cancel',
      description: '取消 running 灰度发布（兼容历史 pending）',
      inputSchema: {
        type: 'object',
        required: ['canaryId'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        cancelCanaryReleaseInputSchema.parse({});
        return service.cancel(projectId, canaryId, getMcpActor(ctx));
      },
    },
    {
      name: 'canary_release_update_traffic_ratio',
      description:
        '调整 running / stopped 灰度发布的流量比例；split 模式 running 且 trafficRatio=1 会触发 from_canary 晋升',
      inputSchema: {
        type: 'object',
        required: ['canaryId', 'trafficRatio'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
          trafficRatio: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        const payload = updateCanaryTrafficRatioInputSchema.parse({ trafficRatio: input.trafficRatio });
        return service.updateTrafficRatio(projectId, canaryId, payload, getMcpActor(ctx));
      },
    },
    {
      name: 'canary_release_delete',
      description: '删除灰度发布；若被正式发布事件引用需 force=true 跳过引用预检',
      inputSchema: {
        type: 'object',
        required: ['canaryId'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
          force: { type: 'boolean' },
          reason: { type: 'string', maxLength: 2000 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        return service.softDelete(
          projectId,
          canaryId,
          {
            force: Boolean(input.force),
            reason: typeof input.reason === 'string' ? input.reason : undefined,
          },
          getMcpActor(ctx),
        );
      },
    },
    {
      name: 'canary_release_annotation_list',
      description: '列出灰度发布的标注样本（pending / claimed / submitted 三种状态可筛）',
      inputSchema: {
        type: 'object',
        required: ['canaryId'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['pending', 'claimed', 'submitted'] },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        const limit = typeof input.limit === 'number' ? input.limit : 20;
        const offset = typeof input.offset === 'number' ? input.offset : 0;
        const status =
          input.status === 'pending' || input.status === 'claimed' || input.status === 'submitted'
            ? input.status
            : undefined;
        return service.listAnnotations(projectId, canaryId, { status, limit, offset }, getMcpActor(ctx));
      },
    },
    {
      name: 'canary_release_annotation_claim',
      description: '抢占式批量领取灰度标注样本（最多 100 条；5 分钟无心跳自动归还）',
      inputSchema: {
        type: 'object',
        required: ['canaryId', 'batchSize'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
          batchSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        const payload = claimCanaryAnnotationsInputSchema.parse({ batchSize: input.batchSize });
        return service.claimAnnotations(projectId, canaryId, payload, getMcpActor(ctx));
      },
    },
    {
      name: 'canary_release_annotation_submit',
      description: '提交灰度标注样本（仅本人锁定的样本可提交）',
      inputSchema: {
        type: 'object',
        required: ['canaryId', 'annotationId'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
          annotationId: { type: 'string', format: 'uuid' },
          isCorrect: { type: ['boolean', 'null'] },
          notes: { type: ['string', 'null'] },
          fields: { type: 'object', additionalProperties: true },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        const payload = submitCanaryAnnotationInputSchema.parse({
          annotationId: input.annotationId,
          isCorrect: input.isCorrect ?? null,
          notes: input.notes ?? null,
          fields: (input.fields as Record<string, unknown> | undefined) ?? {},
        });
        return service.submitAnnotation(projectId, canaryId, payload, getMcpActor(ctx));
      },
    },
    {
      name: 'canary_release_annotation_release',
      description: '释放当前用户锁定的灰度标注样本回队列',
      inputSchema: {
        type: 'object',
        required: ['canaryId', 'annotationId'],
        properties: {
          canaryId: { type: 'string', format: 'uuid' },
          annotationId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const canaryId = uuidParam.parse(input.canaryId);
        const payload = releaseCanaryAnnotationInputSchema.parse({
          annotationId: input.annotationId,
        });
        return service.releaseAnnotation(projectId, canaryId, payload, getMcpActor(ctx));
      },
    },
  ];
}
