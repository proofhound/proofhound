/**
 * MCP tool definitions for user tokens (local-admin-console credentials; the same token can be used for both the HTTP API and MCP).
 * Token plaintext is only returned by explicit create / reveal operations.
 *
 * See docs/specs/06-database-schema.md §3.2 / docs/specs/08-saas-adapter-boundary.md §3.5.
 */
import { createUserTokenSchema, tokenIdParamSchema, updateUserTokenSchema } from '@proofhound/shared';
import { getMcpActor } from './mcp-context';
import type { TokenService } from '../../modules/token/token.service';
import type { McpToolDefinition } from './mcp.types';

export function createTokenTools(service: TokenService): McpToolDefinition[] {
  return [
    {
      name: 'token_list',
      description: '列出本地管理端用户 Token（只返回 prefix，不返回明文）',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input, ctx) => service.listUserTokens(getMcpActor(ctx)),
    },
    {
      name: 'token_create',
      description: '创建用户 Token（返回明文；同一 Token 可用于 HTTP API 与 MCP 调用）',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          ipWhitelist: { type: 'array', items: { type: 'string' } },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      handler: async (input, ctx) => {
        const dto = createUserTokenSchema.parse({
          name: input.name,
          ipWhitelist: input.ipWhitelist,
          expiresAt: input.expiresAt,
        });
        return service.createUserToken(dto, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'token_reveal',
      description: '查看用户 Token 明文；仅对已加密保存明文的 Token 返回 plaintext',
      inputSchema: {
        type: 'object',
        required: ['tokenId'],
        properties: {
          tokenId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) =>
        service.revealUserToken(tokenIdParamSchema.parse(input.tokenId), getMcpActor(ctx), 'mcp'),
    },
    {
      name: 'token_update',
      description: '更新用户 Token 名称和失效时间；不改变明文、前缀、hash 或 IP 白名单',
      inputSchema: {
        type: 'object',
        required: ['tokenId', 'name'],
        properties: {
          tokenId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          expiresAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      handler: async (input, ctx) => {
        const dto = updateUserTokenSchema.parse({
          name: input.name,
          expiresAt: input.expiresAt,
        });
        return service.updateUserToken(tokenIdParamSchema.parse(input.tokenId), dto, getMcpActor(ctx), 'mcp');
      },
    },
    {
      name: 'token_delete',
      description: '删除用户 Token；实际执行为吊销 revoked_at，Token 将立即失效',
      inputSchema: {
        type: 'object',
        required: ['tokenId'],
        properties: {
          tokenId: { type: 'string', format: 'uuid' },
        },
      },
      handler: async (input, ctx) =>
        service.deleteUserToken(tokenIdParamSchema.parse(input.tokenId), getMcpActor(ctx), 'mcp'),
    },
  ];
}
