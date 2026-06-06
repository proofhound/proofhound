/**
 * MCP tool definitions for the connector domain.
 * Each tool delegates to ConnectorService, matching the REST surface 1:1.
 * See docs/specs/00-overview.md §5 (three-channel parity) / docs/specs/26-connectors.md §3
 */
import {
  bulkDeleteConnectorsRequestSchema,
  connectorDeleteQuerySchema,
  connectorIdParamSchema,
  connectorListQuerySchema,
  createConnectorSchema,
  createWebhookTokenSchema,
  peekConnectorRequestSchema,
  updateConnectorSchema,
} from '@proofhound/shared';
import { z } from 'zod';
import { getMcpActor, resolveMcpProjectContext } from './mcp-context';
import type { ConnectorService } from '../../modules/connector/connector.service';
import type { McpToolDefinition } from './mcp.types';

const connectorIdInputSchema = {
  type: 'object',
  required: ['connectorId'],
  properties: {
    connectorId: { type: 'string', format: 'uuid' },
  },
} as const;

export function createConnectorTools(service: ConnectorService): McpToolDefinition[] {
  return [
    {
      name: 'connector_list',
      description: '列出连接器',
      inputSchema: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['input', 'output'] },
          type: { type: 'string', enum: ['redis', 'kafka', 'webhook'] },
          healthStatus: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy', 'unknown'] },
          search: { type: 'string' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const query = connectorListQuerySchema.parse({
          direction: input.direction,
          type: input.type,
          healthStatus: input.healthStatus,
          search: input.search,
        });
        return service.list(projectId, getMcpActor(ctx), query);
      },
    },
    {
      name: 'connector_get',
      description: '读取连接器详情',
      inputSchema: connectorIdInputSchema,
      handler: async (input, ctx) =>
        service.getDetail(
          resolveMcpProjectContext(ctx).projectId,
          connectorIdParamSchema.parse(input.connectorId),
          getMcpActor(ctx),
        ),
    },
    {
      name: 'connector_get_references',
      description: '获取连接器引用统计(被哪些灰度 / 正式发布占用)',
      inputSchema: connectorIdInputSchema,
      handler: async (input, ctx) =>
        service.getReferences(
          resolveMcpProjectContext(ctx).projectId,
          connectorIdParamSchema.parse(input.connectorId),
          getMcpActor(ctx),
        ),
    },
    {
      name: 'connector_create',
      description: '创建连接器',
      inputSchema: { type: 'object', properties: {} },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const dto = createConnectorSchema.parse(input);
        return service.create(projectId, dto, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'connector_update',
      description: '更新连接器(direction / type 不可改)',
      inputSchema: connectorIdInputSchema,
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const connectorId = connectorIdParamSchema.parse(input.connectorId);
        const { connectorId: _c, ...rest } = input;
        const dto = updateConnectorSchema.parse(rest);
        return service.update(projectId, connectorId, dto, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'connector_delete',
      description: '删除连接器(被运行中发布占用时拒绝,force=true 强删)',
      inputSchema: {
        type: 'object',
        required: ['connectorId'],
        properties: {
          connectorId: { type: 'string', format: 'uuid' },
          force: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const connectorId = connectorIdParamSchema.parse(input.connectorId);
        const query = connectorDeleteQuerySchema.parse({ force: input.force, reason: input.reason });
        await service.delete(projectId, connectorId, query, getMcpActor(ctx), 'mcp');
        return { ok: true };
      },
    },
    {
      name: 'connector_bulk_delete',
      description: '批量删除连接器(返回 deletedIds / rejected)',
      inputSchema: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
          force: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const dto = bulkDeleteConnectorsRequestSchema.parse({
          ids: input.ids,
          force: input.force,
          reason: input.reason,
        });
        return service.bulkDelete(projectId, dto, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'connector_probe',
      description: '对连接器发起健康探测(本期 stub,返回 driver not implemented)',
      inputSchema: connectorIdInputSchema,
      handler: async (input, ctx) => {
        const { projectId, orgId } = resolveMcpProjectContext(ctx);
        return service.probe(
          projectId,
          connectorIdParamSchema.parse(input.connectorId),
          getMcpActor(ctx),
          'mcp',
          orgId,
        );
      },
    },
    {
      name: 'connector_list_webhook_tokens',
      description: '列出该 webhook 输入 connector 的全部 active webhook token',
      inputSchema: connectorIdInputSchema,
      handler: async (input, ctx) =>
        service.listWebhookTokens(
          resolveMcpProjectContext(ctx).projectId,
          connectorIdParamSchema.parse(input.connectorId),
          getMcpActor(ctx),
        ),
    },
    {
      name: 'connector_create_webhook_token',
      description: '为 webhook 输入 connector 生成新的入站凭证(明文只在响应里出现一次)',
      inputSchema: {
        type: 'object',
        required: ['connectorId'],
        properties: {
          connectorId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const connectorId = connectorIdParamSchema.parse(input.connectorId);
        const dto = createWebhookTokenSchema.parse({ name: input.name, expiresAt: input.expiresAt });
        return service.createWebhookToken(projectId, connectorId, dto, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'connector_revoke_webhook_token',
      description: '吊销 webhook connector 的指定 token(立即生效)',
      inputSchema: {
        type: 'object',
        required: ['connectorId', 'tokenId'],
        properties: {
          connectorId: { type: 'string', format: 'uuid' },
          tokenId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const connectorId = connectorIdParamSchema.parse(input.connectorId);
        const tokenId = z.string().uuid().parse(input.tokenId);
        await service.revokeWebhookToken(projectId, connectorId, tokenId, getMcpActor(ctx), 'mcp');
        return { ok: true };
      },
    },
    {
      name: 'connector_reveal_webhook_token',
      description: '查看 webhook connector 指定 token 的明文(从 token_encrypted 解密)',
      inputSchema: {
        type: 'object',
        required: ['connectorId', 'tokenId'],
        properties: {
          connectorId: { type: 'string', format: 'uuid' },
          tokenId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const connectorId = connectorIdParamSchema.parse(input.connectorId);
        const tokenId = z.string().uuid().parse(input.tokenId);
        return service.revealWebhookToken(projectId, connectorId, tokenId, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'connector_peek',
      description: '抽样调试:不消费前提下读取最近 N 条消息(仅输入连接器,N≤10),并保存最近一次探测结果',
      inputSchema: {
        type: 'object',
        required: ['connectorId'],
        properties: {
          connectorId: { type: 'string', format: 'uuid' },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
      handler: async (input, ctx) => {
        const { projectId } = resolveMcpProjectContext(ctx);
        const connectorId = connectorIdParamSchema.parse(input.connectorId);
        const body = peekConnectorRequestSchema.parse({ limit: input.limit });
        return service.peek(projectId, connectorId, body, getMcpActor(ctx), 'mcp');
      },
    },
  ];
}
