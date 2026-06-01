import {
  modelMonitoringRankingSortBy,
  projectMonitoringFilterSchema,
  promptMonitoringRankingSortBy,
} from '@proofhound/shared';
import { z } from 'zod';
import type { MonitoringService } from '../../modules/monitoring/monitoring.service';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { McpToolDefinition } from './mcp.types';

const filterInputProperties = {
  from: { type: 'string', format: 'date-time' },
  to: { type: 'string', format: 'date-time' },
  granularity: { type: 'string', enum: ['auto', 'minute', 'hour', 'day'] },
  modelIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
  promptIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
  promptVersionIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
  sourceIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
  sources: { type: 'array', items: { type: 'string', enum: ['prod', 'canary', 'iter', 'exp'] } },
} as const;

export function createMonitoringTools(service: MonitoringService): McpToolDefinition[] {
  return [
    {
      name: 'monitoring_get_stats',
      description: '读取当前本地项目运行结果聚合 KPI（请求 / 失败 / RPM / TPM / Token / 成本）',
      inputSchema: {
        type: 'object',
        required: ['from', 'to'],
        properties: filterInputProperties,
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        return service.getStats(projectId, projectMonitoringFilterSchema.parse(input), getMcpActor(ctx));
      },
    },
    {
      name: 'monitoring_get_timeseries',
      description: '读取当前本地项目运行结果时序聚合，按来源桶拆分',
      inputSchema: {
        type: 'object',
        required: ['from', 'to'],
        properties: filterInputProperties,
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        return service.getTimeseries(projectId, projectMonitoringFilterSchema.parse(input), getMcpActor(ctx));
      },
    },
    {
      name: 'monitoring_get_prompt_ranking',
      description: '读取当前本地项目提示词监控排行',
      inputSchema: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          ...filterInputProperties,
          sortBy: { type: 'string', enum: promptMonitoringRankingSortBy },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const sortBy = z.enum(promptMonitoringRankingSortBy).default('requests').parse(input.sortBy);
        return service.getPromptRanking(projectId, projectMonitoringFilterSchema.parse(input), sortBy, getMcpActor(ctx));
      },
    },
    {
      name: 'monitoring_get_model_ranking',
      description: '读取当前本地项目模型监控排行',
      inputSchema: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          ...filterInputProperties,
          sortBy: { type: 'string', enum: modelMonitoringRankingSortBy },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const sortBy = z.enum(modelMonitoringRankingSortBy).default('requests').parse(input.sortBy);
        return service.getModelRanking(projectId, projectMonitoringFilterSchema.parse(input), sortBy, getMcpActor(ctx));
      },
    },
  ];
}
