import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { createProductionReleaseInputSchema, stopProductionReleaseInputSchema } from '@proofhound/shared';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { resolveProjectContext } from '../../common/project-context';
import { ProductionReleaseService } from './production-release.service';

const uuidSchema = z.string().uuid();

@Controller('production-releases')
@UseGuards(HttpActorGuard)
export class ProductionReleaseController {
  constructor(private readonly service: ProductionReleaseService) {}

  @Get()
  async list(@CurrentUser() actor: CurrentUserPayload) {
    return this.service.list(resolveProjectContext(actor).projectId, actor);
  }

  @Post()
  async create(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = createProductionReleaseInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.create(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Get(':eventId')
  async detail(
    @Param('eventId') eventId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.service.getDetail(resolveProjectContext(actor).projectId, this.parseUuid(eventId), actor);
  }

  @Get('by-prompt/:promptId/history')
  async historyByPrompt(
    @Param('promptId') promptId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.service.getHistory(resolveProjectContext(actor).projectId, this.parseUuid(promptId), actor);
  }

  @Post(':eventId/stop')
  async stop(
    @Param('eventId') eventId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = stopProductionReleaseInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.stop(resolveProjectContext(actor).projectId, this.parseUuid(eventId), parse.data, actor);
  }

  private parseUuid(value: string): string {
    const parse = uuidSchema.safeParse(value);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
