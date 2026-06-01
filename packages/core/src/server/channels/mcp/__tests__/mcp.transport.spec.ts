import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { McpDispatchContextFactory } from '../mcp-context';
import { McpTransportService } from '../mcp.transport';

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    on: vi.fn(),
  };
  return res;
}

describe('McpTransportService', () => {
  it('responds 401 with the resolver error code when authentication fails (before touching the SDK)', async () => {
    const factory = {
      build: vi.fn().mockRejectedValue(new UnauthorizedException('invalid_user_token')),
    } as unknown as McpDispatchContextFactory;
    const service = new McpTransportService([], factory);
    const res = fakeRes();

    await service.handle({ headers: { authorization: 'Bearer ph_bad' } } as unknown as Request, res as unknown as Response);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_user_token' });
    expect(res.on).not.toHaveBeenCalled(); // never reached the transport wiring
  });
});
