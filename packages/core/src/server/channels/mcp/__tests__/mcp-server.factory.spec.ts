import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { buildToolList, dispatchTool } from '../mcp-server.factory';
import type { McpToolContext, McpToolDefinition } from '../mcp.types';

const ctx: McpToolContext = {
  actorUserId: 'tok-1',
  actor: {
    sub: 'tok-1',
    actorId: 'tok-1',
    actorKind: 'system_mcp',
    projectId: 'p-1',
    email: '',
    isSuperAdmin: false,
    isActive: true,
  },
};

function tools(handler: McpToolDefinition['handler'] = vi.fn(async () => ({ ok: true }))): McpToolDefinition[] {
  return [
    {
      name: 'token_list',
      description: 'list tokens',
      inputSchema: { type: 'object', properties: {} },
      handler,
    },
  ];
}

describe('mcp-server.factory', () => {
  it('buildToolList maps name/description/inputSchema', () => {
    expect(buildToolList(tools())).toEqual([
      { name: 'token_list', description: 'list tokens', inputSchema: { type: 'object', properties: {} } },
    ]);
  });

  it('dispatchTool calls the matching handler with (args, ctx) and wraps the result as text content', async () => {
    const handler = vi.fn(async () => ({ items: [1, 2] }));
    const result = await dispatchTool(tools(handler), 'token_list', { q: 'x' }, ctx);

    expect(handler).toHaveBeenCalledWith({ q: 'x' }, ctx);
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify({ items: [1, 2] }) }] });
  });

  it('dispatchTool throws McpError (MethodNotFound) for an unknown tool', async () => {
    await expect(dispatchTool(tools(), 'nope', {}, ctx)).rejects.toBeInstanceOf(McpError);
  });
});
