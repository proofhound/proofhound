// McpTransportService — Streamable HTTP (stateless) MCP transport.
// See docs/specs/09-mcp-server.md.
//
// Per request: authenticate via McpDispatchContextFactory (McpAuthResolver → ProjectContext), then
// stand up a fresh stateless StreamableHTTPServerTransport + Server with that context baked in, and
// delegate the request to the SDK. A failed auth maps to HTTP 401 with the resolver's error code.

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { createLogger } from '@proofhound/logger';
import { McpDispatchContextFactory } from './mcp-context';
import { createMcpServer } from './mcp-server.factory';
import { MCP_TOOLS } from './mcp.tokens';
import type { McpToolDefinition } from './mcp.types';

@Injectable()
export class McpTransportService {
  private readonly logger = createLogger('mcp.transport', { service: 'api' });

  constructor(
    @Inject(MCP_TOOLS) private readonly tools: McpToolDefinition[],
    private readonly contextFactory: McpDispatchContextFactory,
  ) {}

  async handle(req: Request, res: Response): Promise<void> {
    let ctx;
    try {
      ctx = await this.contextFactory.build({ headers: req.headers });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        const code = (error.getResponse() as { message?: string })?.message ?? 'invalid_user_token';
        res.status(401).json({ error: code });
        return;
      }
      throw error;
    }

    // Stateless: one transport + server per request, torn down when the response closes.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createMcpServer(this.tools, ctx);

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error({ err: error }, 'mcp_request_failed');
      if (!res.headersSent) res.status(500).json({ error: 'mcp_internal_error' });
    }
  }
}
