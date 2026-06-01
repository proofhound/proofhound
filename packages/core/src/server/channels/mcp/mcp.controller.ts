// McpController — Streamable HTTP entry for the MCP server at /mcp.
// See docs/specs/09-mcp-server.md.
//
// Deliberately NOT under @UseGuards(HttpActorGuard): MCP authentication is performed inside the
// transport via McpAuthResolver (§3.3), not the HTTP actor guard. Every method delegates to the
// SDK transport, which routes POST (requests), GET (stream), and DELETE (teardown) internally.

import { Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpTransportService } from './mcp.transport';

@Controller('mcp')
export class McpController {
  constructor(private readonly transport: McpTransportService) {}

  @Post()
  async post(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.transport.handle(req, res);
  }

  @Get()
  async get(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.transport.handle(req, res);
  }

  @Delete()
  async delete(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.transport.handle(req, res);
  }
}
