/**
 * MCP tool definitions for unified release lines.
 * Mirrors the REST surface for release line read APIs, traffic-ratio adjustment,
 * and run config changes.
 * See docs/specs/00-overview.md §5 (three-channel parity) + docs/specs/27-releases.md.
 */
import { updateReleaseLineRunConfigInputSchema, updateReleaseLineTrafficRatioInputSchema } from '@proofhound/shared';
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
      name: 'release_line_update_run_config',
      description: '通过配置变更事件更新发布线当前 production 或灰度 lane 的模型与运行配置',
      inputSchema: {
        type: 'object',
        required: ['releaseLineId', 'laneType', 'runConfig'],
        properties: {
          releaseLineId: { type: 'string', format: 'uuid' },
          laneType: { type: 'string', enum: ['production', 'canary'] },
          modelId: { type: 'string', format: 'uuid' },
          runConfig: { type: 'object', additionalProperties: true },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const releaseLineId = uuidParam.parse(input.releaseLineId);
        const body = updateReleaseLineRunConfigInputSchema.parse({
          laneType: input.laneType,
          modelId: input.modelId,
          runConfig: input.runConfig,
        });
        return service.updateRunConfig(projectId, releaseLineId, body, getMcpActor(ctx));
      },
    },
  ];
}
