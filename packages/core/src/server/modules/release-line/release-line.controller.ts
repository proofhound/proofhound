import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  archiveReleaseLineInputSchema,
  deleteReleaseLineInputSchema,
  restoreReleaseLineHistoryInputSchema,
  startReleaseLineInputSchema,
  stopReleaseLineInputSchema,
  unarchiveReleaseLineInputSchema,
  updateReleaseLineInputRouteInputSchema,
  updateReleaseLineOutputRouteInputSchema,
  updateReleaseLineRunConfigInputSchema,
  updateReleaseLineTrafficRatioInputSchema,
} from '@proofhound/shared';
import { z } from 'zod';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
import { ReleaseLineService } from './release-line.service';

const uuidSchema = z.string().uuid();

@Controller('release-lines')
@UseGuards(HttpActorGuard)
export class ReleaseLineController {
  constructor(private readonly service: ReleaseLineService) {}

  @Get()
  async list(@CurrentUser() actor: CurrentUserPayload, @CurrentProject() project: ProjectContext) {
    return this.service.list(project.projectId, actor);
  }

  @Get(':releaseLineId')
  async get(
    @Param('releaseLineId') releaseLineId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.get(project.projectId, this.parseUuid(releaseLineId), actor);
  }

  @Get(':releaseLineId/events')
  async events(
    @Param('releaseLineId') releaseLineId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.listEvents(project.projectId, this.parseUuid(releaseLineId), actor);
  }

  @Get(':releaseLineId/delete-impact')
  async deleteImpact(
    @Param('releaseLineId') releaseLineId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.getDeletionImpact(project.projectId, this.parseUuid(releaseLineId), actor);
  }

  @Post(':releaseLineId/traffic-ratio')
  async updateTrafficRatio(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updateReleaseLineTrafficRatioInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.updateTrafficRatio(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
  }

  @Post(':releaseLineId/promote-canary')
  async promoteCanary(
    @Param('releaseLineId') releaseLineId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.promoteCanary(project.projectId, this.parseUuid(releaseLineId), actor);
  }

  @Post(':releaseLineId/stop')
  async stopLine(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = stopReleaseLineInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.stopLine(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
  }

  @Post(':releaseLineId/start')
  async startLine(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = startReleaseLineInputSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.startLine(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
  }

  @Post(':releaseLineId/archive')
  async archiveLine(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = archiveReleaseLineInputSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.archiveLine(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
  }

  @Post(':releaseLineId/unarchive')
  async unarchiveLine(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = unarchiveReleaseLineInputSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.unarchiveLine(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
  }

  @Post(':releaseLineId/restore-production')
  async restoreHistoryToProduction(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = restoreReleaseLineHistoryInputSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.restoreHistoryToProduction(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
  }

  @Post(':releaseLineId/restore-canary')
  async restoreHistoryToCanary(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = restoreReleaseLineHistoryInputSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.restoreHistoryToCanary(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
  }

  @Delete(':releaseLineId')
  async deleteLine(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = deleteReleaseLineInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    await this.service.deleteLine(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
    return { ok: true };
  }

  @Post(':releaseLineId/run-config')
  async updateRunConfig(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updateReleaseLineRunConfigInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.updateRunConfig(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
  }

  @Post(':releaseLineId/output-route')
  async updateOutputRoute(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updateReleaseLineOutputRouteInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.updateOutputRoute(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
  }

  @Post(':releaseLineId/input-route')
  async updateInputRoute(
    @Param('releaseLineId') releaseLineId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updateReleaseLineInputRouteInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.updateInputRoute(project.projectId, this.parseUuid(releaseLineId), parse.data, actor);
  }

  private parseUuid(value: string): string {
    const parse = uuidSchema.safeParse(value);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
