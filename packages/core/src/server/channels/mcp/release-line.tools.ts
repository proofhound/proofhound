/**
 * MCP tool definitions for unified release lines.
 * Mirrors the REST surface for release line read APIs, canary promotion,
 * traffic-ratio adjustment, and config changes.
 * See docs/specs/00-overview.md §5 (three-channel parity) + docs/specs/27-releases.md.
 */
import {
  archiveReleaseLineInputSchema,
  deleteReleaseLineInputSchema,
  restoreReleaseLineHistoryInputSchema,
  startReleaseLineInputSchema,
  stopReleaseLineInputSchema,
  unarchiveReleaseLineInputSchema,
  updateReleaseLineInputRouteInputSchema,
  updateReleaseLineOutputRouteInputSchema,
  updateReleaseLineRetentionInputSchema,
  updateReleaseLineRunConfigInputSchema,
  updateReleaseLineTrafficRatioInputSchema,
} from '@proofhound/shared';
import { z } from 'zod';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { ReleaseLineService } from '../../modules/release-line/release-line.service';
import type { McpToolDefinition } from './mcp.types';

const uuidParam = z.string().uuid();

export function createReleaseLineTools(service: ReleaseLineService): McpToolDefinition[] {
  return [
    {
      name: 'release_line_list',
      description: '列出统一发布线及当前生产 / 灰度 lane',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        return service.list(projectId, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_get',
      description: '读取单条发布线详情',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        return service.get(projectId, releaseLineId, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_event_list',
      description: '列出发布线操作历史事件',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        return service.listEvents(projectId, releaseLineId, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_delete_impact',
      description: '预览彻底删除发布线会移除的版本、事件、发布运行结果与标注任务',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        return service.getDeletionImpact(projectId, releaseLineId, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_update_traffic_ratio',
      description: '调整发布线当前灰度 lane 的流量比例',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId', 'trafficRatio'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          trafficRatio: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = updateReleaseLineTrafficRatioInputSchema.parse({ trafficRatio: input.trafficRatio });
        return service.updateTrafficRatio(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_update_retention',
      description: '更新发布线当前正式发布 lane 的运行结果保留天数；retentionDays=null 表示永久保留',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId', 'retentionDays'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          retentionDays: { type: ['number', 'null'], minimum: 1 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = updateReleaseLineRetentionInputSchema.parse({ retentionDays: input.retentionDays });
        return service.updateRetention(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_promote_canary',
      description: '将发布线当前运行中的灰度 lane 提升为正式发布',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        return service.promoteCanary(projectId, releaseLineId, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_stop',
      description: '停止发布线当前运行中的 production / 灰度 lane',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId', 'reason'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = stopReleaseLineInputSchema.parse({ reason: input.reason });
        return service.stopLine(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_start',
      description: '从最近一次停止的 production / 灰度 lane 恢复运行发布线',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = startReleaseLineInputSchema.parse({ reason: input.reason });
        return service.startLine(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_archive',
      description: '归档已停止的发布线',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = archiveReleaseLineInputSchema.parse({ reason: input.reason });
        return service.archiveLine(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_unarchive',
      description: '取消归档发布线并恢复为 stopped 状态',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = unarchiveReleaseLineInputSchema.parse({ reason: input.reason });
        return service.unarchiveLine(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_restore_history_to_production',
      description: '将发布线的某条历史事件快照恢复到当前正式发布槽位',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId', 'sourceEventId'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          sourceEventId: { type: 'string', format: 'uuid' },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = restoreReleaseLineHistoryInputSchema.parse({
          sourceEventId: input.sourceEventId,
          reason: input.reason,
        });
        return service.restoreHistoryToProduction(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_restore_history_to_canary',
      description: '将发布线的某条历史事件快照恢复到当前灰度候选槽位',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId', 'sourceEventId'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          sourceEventId: { type: 'string', format: 'uuid' },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = restoreReleaseLineHistoryInputSchema.parse({
          sourceEventId: input.sourceEventId,
          reason: input.reason,
        });
        return service.restoreHistoryToCanary(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_delete',
      description: '彻底删除发布线聚合及其版本、事件、发布运行结果与标注任务',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId', 'confirmationName'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          confirmationName: { type: 'string', minLength: 1, maxLength: 200 },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = deleteReleaseLineInputSchema.parse({
          confirmationName: input.confirmationName,
          reason: input.reason,
        });
        await service.deleteLine(projectId, releaseLineId, body, getMcpActor(ctx));
        return { ok: true };
      },
    },
    {
      name: 'release_line_update_run_config',
      description:
        '通过配置变更事件更新发布线当前 production 或灰度 lane 的模型、运行配置与记录模式。' +
        'runConfig 必含 rpmLimit / tpmLimit（正整数），可选 concurrency / temperature；' +
        'laneType="canary" 时额外可带 stopConditions（{ maxDurationSeconds?, maxSamples? } 至少一项非空）。' +
        '不符合所选 lane 形状会被拒绝。',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId', 'laneType', 'runConfig'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          laneType: { type: 'string', enum: ['production', 'canary'] },
          modelId: { type: 'string', format: 'uuid' },
          runConfig: {
            // Shape is laneType-dependent (DTO discriminatedUnion): canary additionally accepts
            // stopConditions; both lanes require rpmLimit/tpmLimit. A mismatch is rejected by the DTO
            // and surfaced as a structured tool error (isError) by the dispatch layer, not a 500.
            description:
              '运行配置；必含 rpmLimit / tpmLimit，可选 concurrency / temperature；canary lane 额外可带 stopConditions。',
            type: 'object',
            additionalProperties: true,
          },
          recordMode: { type: 'string', enum: ['all', 'selected_categories'] },
          recordCategories: { type: 'array', items: { type: 'string' } },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = updateReleaseLineRunConfigInputSchema.parse({
          laneType: input.laneType,
          modelId: input.modelId,
          runConfig: input.runConfig,
          recordMode: input.recordMode,
          recordCategories: input.recordCategories,
        });
        return service.updateRunConfig(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_update_output_route',
      description: '通过配置变更事件更新发布线当前 production 或灰度 lane 的输出连接器与输出字段映射',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId', 'laneType', 'outputConnectorIds', 'outputMapping'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          laneType: { type: 'string', enum: ['production', 'canary'] },
          outputConnectorIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          outputMapping: {
            type: 'array',
            items: {
              type: 'object',
              required: ['connectorId', 'outputMapping'],
              properties: {
                connectorId: { type: 'string', format: 'uuid' },
                outputMapping: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['source', 'target'],
                    properties: {
                      source: { type: 'string', minLength: 1 },
                      target: { type: 'string', minLength: 1 },
                    },
                  },
                },
              },
            },
          },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = updateReleaseLineOutputRouteInputSchema.parse({
          laneType: input.laneType,
          outputConnectorIds: input.outputConnectorIds,
          outputMapping: input.outputMapping,
        });
        return service.updateOutputRoute(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
    {
      name: 'release_line_update_input_route',
      description:
        '通过配置变更事件更新发布线当前 production 或灰度 lane 的字段映射与过滤规则。' +
        'variableMapping 的形状由 laneType 决定：laneType="production" 必须是对象映射（{ 源字段: 目标变量 } 的字符串键值对）；' +
        'laneType="canary" 必须是数组（每项 { source, target, required?, defaultValue? }）。形状与 laneType 不匹配会被拒绝。',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId', 'laneType', 'variableMapping', 'externalIdField'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          laneType: { type: 'string', enum: ['production', 'canary'] },
          variableMapping: {
            // The accepted shape is cross-field dependent on laneType (a Zod discriminatedUnion in the
            // DTO): production => object map, canary => array. JSON Schema oneOf cannot express that
            // dependency, so both shapes are advertised here and the per-lane requirement is documented
            // in the tool description; a mismatched shape is rejected by the DTO and surfaced as a
            // structured tool error (isError) rather than a 500.
            description:
              'laneType="production": 对象映射（值为字符串的键值对）；laneType="canary": 映射项数组（{ source, target, required?, defaultValue? }）。',
            oneOf: [
              {
                description: 'production lane 形状：源字段 -> 目标变量 的字符串映射',
                type: 'object',
                additionalProperties: { type: 'string' },
              },
              {
                description: 'canary lane 形状：映射项数组',
                type: 'array',
                items: {
                  type: 'object',
                  required: ['source', 'target'],
                  properties: {
                    source: { type: 'string', minLength: 1 },
                    target: { type: 'string', minLength: 1 },
                    required: { type: 'boolean' },
                    defaultValue: {},
                  },
                },
              },
            ],
          },
          filterRules: { type: ['object', 'null'], additionalProperties: true },
          externalIdField: { type: 'string', minLength: 1 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = updateReleaseLineInputRouteInputSchema.parse({
          laneType: input.laneType,
          variableMapping: input.variableMapping,
          filterRules: input.filterRules ?? null,
          externalIdField: input.externalIdField,
        });
        return service.updateInputRoute(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
  ];
}
