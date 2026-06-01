import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { updateReleaseLineRunConfigInputSchema, updateReleaseLineTrafficRatioInputSchema } from '@proofhound/shared';
import { z } from 'zod';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { resolveProjectContext } from '../../common/project-context';
import { ReleaseLineService } from './release-line.service';

const uuidSchema = z.string().uuid();

@Controller('release-lines')
@UseGuards(HttpActorGuard)
export class ReleaseLineController {
  constructor(private readonly service: ReleaseLineService) {}

  @Get()
  async list(@CurrentUser() actor: CurrentUserPayload) {
    return this.service.list(resolveProjectContext(actor).projectId, actor);
  }

  @Get(':releaseLineId')
  async get(@Param('releaseLineId') releaseLineId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.get(resolveProjectContext(actor).projectId, this.parseUuid(releaseLineId), actor);
  }

  @Get(':releaseLineId/events')
  async events(@Param('releaseLineId') releaseLineId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.listEvents(resolveProjectContext(actor).projectId, this.parseUuid(releaseLineId), actor);
  }

  @Post(':releaseLineId/traffic-ratio')
  async updateTrafficRatio(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = updateReleaseLineTrafficRatioInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.updateTrafficRatio(
      resolveProjectContext(actor).projectId,
      this.parseUuid(releaseLineId),
      parse.data,
      actor,
    );
  }

  @Post(':releaseLineId/run-config')
  async updateRunConfig(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = updateReleaseLineRunConfigInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.updateRunConfig(
      resolveProjectContext(actor).projectId,
      this.parseUuid(releaseLineId),
      parse.data,
      actor,
    );
  }

  private parseUuid(value: string): string {
    const parse = uuidSchema.safeParse(value);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
