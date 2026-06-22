import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  createDatasetSchema,
  datasetExportFormatSchema,
  datasetIdParamSchema,
  datasetSamplesQuerySchema,
  deleteDatasetSamplesSchema,
  updateDatasetMetadataSchema,
} from '@proofhound/shared';
import type { Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
import { DatasetService } from './dataset.service';

@Controller('datasets')
@UseGuards(HttpActorGuard)
export class DatasetController {
  constructor(private readonly datasetService: DatasetService) {}

  @Get()
  async listDatasets(@CurrentUser() actor: CurrentUserPayload, @CurrentProject() project: ProjectContext) {
    return this.datasetService.listDatasets(project.projectId, actor);
  }

  @Get(':datasetId/samples')
  async listDatasetSamples(
    @Param('datasetId') datasetId: string,
    @Query() rawQuery: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = datasetSamplesQuerySchema.safeParse(rawQuery);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.listDatasetSamples(project.projectId, this.parseDatasetId(datasetId), actor, parse.data);
  }

  @Get(':datasetId/export')
  async exportDataset(
    @Param('datasetId') datasetId: string,
    @Query('format') format: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parse = datasetExportFormatSchema.safeParse(format ?? 'csv');
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    const delivery = await this.datasetService.exportDatasetForDownload(
      project,
      this.parseDatasetId(datasetId),
      parse.data,
      actor,
    );

    // Object storage minted a signed URL → 302 to it so the bytes are served directly by the store
    // (the existing blob-fetch client transparently follows the redirect). No DTO / client change.
    if (delivery.kind === 'redirect') {
      response.status(HttpStatus.FOUND).set({ Location: delivery.url });
      return undefined;
    }

    const file = delivery.file;
    response.set({
      'Content-Disposition': `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Content-Type': file.contentType,
    });

    return new StreamableFile(file.createStream());
  }

  @Get(':datasetId')
  async getDataset(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.datasetService.getDataset(project.projectId, this.parseDatasetId(datasetId), actor);
  }

  @Get(':datasetId/delete-impact')
  async getDatasetDeleteImpact(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.datasetService.getDatasetDeleteImpact(project.projectId, this.parseDatasetId(datasetId), actor);
  }

  @Post()
  async createDataset(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = createDatasetSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.createDataset(project.projectId, parse.data, actor);
  }

  @Patch(':datasetId')
  async updateDatasetMetadata(
    @Param('datasetId') datasetId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updateDatasetMetadataSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.updateDatasetMetadata(
      project.projectId,
      this.parseDatasetId(datasetId),
      parse.data,
      actor,
    );
  }

  @Patch(':datasetId/archive')
  async archiveDataset(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.datasetService.archiveDataset(project.projectId, this.parseDatasetId(datasetId), actor);
  }

  @Patch(':datasetId/restore')
  async restoreDataset(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.datasetService.restoreDataset(project.projectId, this.parseDatasetId(datasetId), actor);
  }

  @Delete(':datasetId/samples')
  @HttpCode(HttpStatus.OK)
  async deleteDatasetSamples(
    @Param('datasetId') datasetId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = deleteDatasetSamplesSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.deleteDatasetSamples(
      project.projectId,
      this.parseDatasetId(datasetId),
      parse.data,
      actor,
    );
  }

  @Delete(':datasetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDataset(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    await this.datasetService.deleteDataset(project.projectId, this.parseDatasetId(datasetId), actor);
  }

  private parseDatasetId(datasetId: string) {
    const parse = datasetIdParamSchema.safeParse(datasetId);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return parse.data;
  }
}
