import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('healthz')
  check() {
    return this.health.liveness();
  }

  @Get('readyz')
  async ready(@Res({ passthrough: true }) response: Response) {
    const result = await this.health.readiness();
    if (result.status !== 'ok') response.status(503);
    return result;
  }
}
