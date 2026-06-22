import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  experimentIdParamSchema,
  releaseRunResultCleanupFilterSchema,
  releaseRunResultCleanupInputSchema,
  runResultExportFormatSchema,
  runResultListQuerySchema,
  runResultReleaseListQuerySchema,
} from '@proofhound/shared';
import { z } from 'zod';
import type { Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
import { RunResultService } from './run-result.service';
import { type RunResultExportFile } from './run-result.service';

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

  @Get('export')
  async exportForExperiment(
    @Param('experimentId') experimentId: string,
    @Query() rawQuery: Record<string, unknown>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const queryParse = runResultListQuerySchema.safeParse(rawQuery ?? {});
    if (!queryParse.success) {
      throw new BadRequestException(queryParse.error.issues);
    }
    const formatParse = runResultExportFormatSchema.safeParse(rawQuery?.['format'] ?? 'csv');
    if (!formatParse.success) {
      throw new BadRequestException(formatParse.error.issues);
    }

    const file = await this.runResultService.exportExperimentRunResults(
      project.projectId,
      this.parseExperimentId(experimentId),
      actor,
      formatParse.data,
      queryParse.data,
    );
    setDownloadHeaders(response, file);
    return new StreamableFile(file.stream);
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

  @Get('releases/export')
  async exportForRelease(
    @Query() rawQuery: Record<string, unknown>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const queryParse = runResultReleaseListQuerySchema.safeParse(rawQuery ?? {});
    if (!queryParse.success) {
      throw new BadRequestException(queryParse.error.issues);
    }
    const formatParse = runResultExportFormatSchema.safeParse(rawQuery?.['format'] ?? 'csv');
    if (!formatParse.success) {
      throw new BadRequestException(formatParse.error.issues);
    }

    const file = await this.runResultService.exportReleaseRunResults(
      project.projectId,
      actor,
      formatParse.data,
      queryParse.data,
    );
    setDownloadHeaders(response, file);
    return new StreamableFile(file.stream);
  }

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

  @Post('releases/cleanup-preview')
  async previewCleanup(
    @Body() rawBody: Record<string, unknown>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const bodyParse = releaseRunResultCleanupFilterSchema.safeParse(rawBody ?? {});
    if (!bodyParse.success) {
      throw new BadRequestException(bodyParse.error.issues);
    }

    return this.runResultService.previewReleaseRunResultCleanup(project.projectId, actor, bodyParse.data);
  }

  @Post('releases/cleanup')
  async cleanup(
    @Body() rawBody: Record<string, unknown>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const bodyParse = releaseRunResultCleanupInputSchema.safeParse(rawBody ?? {});
    if (!bodyParse.success) {
      throw new BadRequestException(bodyParse.error.issues);
    }

    return this.runResultService.cleanupReleaseRunResults(project.projectId, actor, bodyParse.data);
  }
}

function setDownloadHeaders(response: Response, file: RunResultExportFile): void {
  const asciiFileName = file.fileName.replace(/["\\]/g, '_');
  response.setHeader('Content-Type', file.contentType);
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
}
