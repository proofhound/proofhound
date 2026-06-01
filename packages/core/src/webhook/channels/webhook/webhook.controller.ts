import { All, Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebhookService } from './webhook.service';

@Controller('webhooks')
export class WebhookController {
  constructor(@Inject(WebhookService) private readonly service: WebhookService) {}

  @Post(':webhookSlug')
  receiveRoot(@Param('webhookSlug') webhookSlug: string, @Body() body: unknown, @Req() request: Request) {
    return this.service.receive({
      webhookSlug,
      pathName: '',
      body,
      authorization: request.header('authorization') ?? null,
      ipAddress: request.ip,
      userAgent: request.header('user-agent') ?? null,
    });
  }

  @Post(':webhookSlug/*pathName')
  receiveNested(
    @Param('webhookSlug') webhookSlug: string,
    @Param('pathName') pathName: string | string[],
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.service.receive({
      webhookSlug,
      pathName: normalizePathName(pathName),
      body,
      authorization: request.header('authorization') ?? null,
      ipAddress: request.ip,
      userAgent: request.header('user-agent') ?? null,
    });
  }

  @Get(':webhookSlug/calls/:callId')
  getCallRoot(@Param('webhookSlug') webhookSlug: string, @Param('callId') callId: string, @Req() request: Request) {
    return this.service.getCallResult({
      webhookSlug,
      pathName: '',
      callId,
      authorization: request.header('authorization') ?? null,
      ipAddress: request.ip,
      userAgent: request.header('user-agent') ?? null,
    });
  }

  @Get(':webhookSlug/*pathName/calls/:callId')
  getCallNested(
    @Param('webhookSlug') webhookSlug: string,
    @Param('pathName') pathName: string | string[],
    @Param('callId') callId: string,
    @Req() request: Request,
  ) {
    return this.service.getCallResult({
      webhookSlug,
      pathName: normalizePathName(pathName),
      callId,
      authorization: request.header('authorization') ?? null,
      ipAddress: request.ip,
      userAgent: request.header('user-agent') ?? null,
    });
  }

  @All()
  fallback() {
    return { status: 'not_found' };
  }
}

function normalizePathName(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join('/');
  return value ?? '';
}
