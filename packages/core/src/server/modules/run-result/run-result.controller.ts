import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { experimentIdParamSchema, runResultListQuerySchema, runResultReleaseListQuerySchema } from '@proofhound/shared';
import { z } from 'zod';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
import { RunResultService } from './run-result.service';

const runResultIdParamSchema = z.string().uuid();

@Controller('experiments/:experimentId/run-results')
@UseGuards(HttpActorGuard)
export class RunResultController {
  constructor(private readonly runResultService: RunResultService) {}

  @Get()
  async listForExperiment(
    @Param('experimentId') experimentId: string,
    @Query() rawQuery: Record<string, unknown>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const queryParse = runResultListQuerySchema.safeParse(rawQuery ?? {});
    if (!queryParse.success) {
      throw new BadRequestException(queryParse.error.issues);
    }

    return this.runResultService.listExperimentRunResults(
      project.projectId,
      this.parseExperimentId(experimentId),
      actor,
      queryParse.data,
    );
  }

  @Get(':runResultId')
  async getOne(
    @Param('experimentId') experimentId: string,
    @Param('runResultId') runResultId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = runResultIdParamSchema.safeParse(runResultId);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.runResultService.getExperimentRunResult(
      project.projectId,
      this.parseExperimentId(experimentId),
      parse.data,
      actor,
    );
  }

  private parseExperimentId(experimentId: string) {
    const parse = experimentIdParamSchema.safeParse(experimentId);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return parse.data;
  }
}

@Controller('run-results')
@UseGuards(HttpActorGuard)
export class ReleaseRunResultController {
  constructor(private readonly runResultService: RunResultService) {}

  @Get('releases')
  async listForRelease(
    @Query() rawQuery: Record<string, unknown>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const queryParse = runResultReleaseListQuerySchema.safeParse(rawQuery ?? {});
    if (!queryParse.success) {
      throw new BadRequestException(queryParse.error.issues);
    }

    return this.runResultService.listReleaseRunResults(project.projectId, actor, queryParse.data);
  }
}
