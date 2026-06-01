import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  createExperimentSchema,
  experimentControlActionSchema,
  experimentExportFormatSchema,
  experimentIdParamSchema,
  experimentListQuerySchema,
} from '@proofhound/shared';
import type { Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { resolveProjectContext } from '../../common/project-context';
import { ExperimentService } from './experiment.service';

@Controller('experiments')
@UseGuards(HttpActorGuard)
export class ExperimentController {
  constructor(private readonly experimentService: ExperimentService) {}

  @Post()
  async createExperiment(
    @Body() body: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parsed = createExperimentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.experimentService.createExperiment(resolveProjectContext(actor).projectId, parsed.data, actor);
  }

  @Get()
  async listExperiments(
    @Query('status') status: string | undefined,
    @Query('search') search: string | undefined,
    @Query('sort') sort: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const query = experimentListQuerySchema.safeParse({ status, search, sort });
    if (!query.success) {
      throw new BadRequestException(query.error.issues);
    }

    return this.experimentService.listExperiments(resolveProjectContext(actor).projectId, actor, query.data);
  }

  @Get('export')
  async exportExperiments(
    @Query('format') format: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parse = experimentExportFormatSchema.safeParse(format ?? 'csv');
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    const file = await this.experimentService.exportExperiments(resolveProjectContext(actor).projectId, parse.data, actor);
    this.setExportHeaders(response, file);
    return new StreamableFile(file.buffer);
  }

  @Get(':experimentId/export')
  async exportExperiment(
    @Param('experimentId') experimentId: string,
    @Query('format') format: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parse = experimentExportFormatSchema.safeParse(format ?? 'csv');
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    const file = await this.experimentService.exportExperiments(
      resolveProjectContext(actor).projectId,
      parse.data,
      actor,
      this.parseExperimentId(experimentId),
    );
    this.setExportHeaders(response, file);
    return new StreamableFile(file.buffer);
  }

  @Get(':experimentId')
  async getExperiment(
    @Param('experimentId') experimentId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.experimentService.getExperiment(
      resolveProjectContext(actor).projectId,
      this.parseExperimentId(experimentId),
      actor,
    );
  }

  @Post(':experimentId/actions/:action')
  async controlExperiment(
    @Param('experimentId') experimentId: string,
    @Param('action') action: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parsedAction = experimentControlActionSchema.safeParse(action);
    if (!parsedAction.success) {
      throw new BadRequestException(parsedAction.error.issues);
    }

    return this.experimentService.controlExperiment(
      resolveProjectContext(actor).projectId,
      this.parseExperimentId(experimentId),
      parsedAction.data,
      actor,
    );
  }

  @Delete(':experimentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteExperiment(
    @Param('experimentId') experimentId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    await this.experimentService.deleteExperiment(
      resolveProjectContext(actor).projectId,
      this.parseExperimentId(experimentId),
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

  private setExportHeaders(response: Response, file: { fileName: string; byteLength: number; contentType: string }) {
    response.set({
      'Content-Disposition': `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Content-Length': String(file.byteLength),
      'Content-Type': file.contentType,
    });
  }
}
