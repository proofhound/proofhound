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
import { resolveProjectContext } from '../../common/project-context';
import { DatasetService } from './dataset.service';

@Controller('datasets')
@UseGuards(HttpActorGuard)
export class DatasetController {
  constructor(private readonly datasetService: DatasetService) {}

  @Get()
  async listDatasets(@CurrentUser() actor: CurrentUserPayload) {
    return this.datasetService.listDatasets(resolveProjectContext(actor).projectId, actor);
  }

  @Get(':datasetId/samples')
  async listDatasetSamples(
    @Param('datasetId') datasetId: string,
    @Query() rawQuery: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = datasetSamplesQuerySchema.safeParse(rawQuery);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.listDatasetSamples(
      resolveProjectContext(actor).projectId,
      this.parseDatasetId(datasetId),
      actor,
      parse.data,
    );
  }

  @Get(':datasetId/export')
  async exportDataset(
    @Param('datasetId') datasetId: string,
    @Query('format') format: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parse = datasetExportFormatSchema.safeParse(format ?? 'csv');
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    const file = await this.datasetService.exportDataset(
      resolveProjectContext(actor).projectId,
      this.parseDatasetId(datasetId),
      parse.data,
      actor,
    );
    response.set({
      'Content-Disposition': `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Content-Length': String(file.byteLength),
      'Content-Type': file.contentType,
    });

    return new StreamableFile(file.buffer);
  }

  @Get(':datasetId')
  async getDataset(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.datasetService.getDataset(resolveProjectContext(actor).projectId, this.parseDatasetId(datasetId), actor);
  }

  @Post()
  async createDataset(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = createDatasetSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.createDataset(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Patch(':datasetId')
  async updateDatasetMetadata(
    @Param('datasetId') datasetId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = updateDatasetMetadataSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.updateDatasetMetadata(
      resolveProjectContext(actor).projectId,
      this.parseDatasetId(datasetId),
      parse.data,
      actor,
    );
  }

  @Delete(':datasetId/samples')
  @HttpCode(HttpStatus.OK)
  async deleteDatasetSamples(
    @Param('datasetId') datasetId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = deleteDatasetSamplesSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.deleteDatasetSamples(
      resolveProjectContext(actor).projectId,
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
  ) {
    await this.datasetService.deleteDataset(resolveProjectContext(actor).projectId, this.parseDatasetId(datasetId), actor);
  }

  private parseDatasetId(datasetId: string) {
    const parse = datasetIdParamSchema.safeParse(datasetId);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return parse.data;
  }
}
