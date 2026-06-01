// mcp-server.factory — builds an MCP SDK Server from the channel's tool definitions.
// See docs/specs/09-mcp-server.md.
//
// Stateless model: one Server (and transport) per request, with the resolver-validated McpToolContext
// baked in. The pure helpers `buildToolList` / `dispatchTool` are exported separately so tool listing
// and dispatch can be unit-tested without standing up an SDK Server or HTTP transport.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpToolContext, McpToolDefinition } from './mcp.types';

const SERVER_INFO = { name: 'proofhound', version: '0.1.0' } as const;

/** Pure: maps tool definitions to the MCP `tools/list` shape. */
export function buildToolList(tools: McpToolDefinition[]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Tool['inputSchema'],
  }));
}

/** Pure: resolves a `tools/call` by name and wraps the Service result as MCP text content. */
export async function dispatchTool(
  tools: McpToolDefinition[],
  name: string,
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<CallToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new McpError(ErrorCode.MethodNotFound, `unknown tool: ${name}`);
  }
  const result = await tool.handler(args, ctx);
  return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
}

/**
 * Builds an MCP Server that serves the given tools under the given (already-authenticated) context.
 * A fresh Server is created per request in the stateless transport.
 */
export function createMcpServer(tools: McpToolDefinition[], ctx: McpToolContext): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: buildToolList(tools) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    dispatchTool(tools, request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>, ctx),
  );

  return server;
}
