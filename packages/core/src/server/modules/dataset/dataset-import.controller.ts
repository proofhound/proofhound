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
  UseGuards,
} from '@nestjs/common';
import {
  createDatasetImportSchema,
  createRawDatasetImportSchema,
  datasetIdParamSchema,
  datasetImportBatchSchema,
} from '@proofhound/shared';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
import { DatasetImportService } from './dataset-import.service';

@Controller('dataset-imports')
@UseGuards(HttpActorGuard)
export class DatasetImportController {
  constructor(private readonly service: DatasetImportService) {}

  @Post()
  async createImport(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = createDatasetImportSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return this.service.createImport(project.projectId, parse.data, actor);
  }

  @Get('raw/capabilities')
  async getRawImportCapabilities(@CurrentUser() actor: CurrentUserPayload, @CurrentProject() project: ProjectContext) {
    return this.service.getRawImportCapabilities(project.projectId, actor);
  }

  @Post('raw')
  async createRawImport(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = createRawDatasetImportSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return this.service.createRawImport(project.projectId, parse.data, actor);
  }

  @Get(':importId')
  async getImport(
    @Param('importId') importId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.getImport(project.projectId, this.parseImportId(importId), actor);
  }

  @Post(':importId/batch')
  async appendBatch(
    @Param('importId') importId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = datasetImportBatchSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return this.service.appendBatch(project.projectId, this.parseImportId(importId), parse.data, actor);
  }

  @Post(':importId/complete')
  async complete(
    @Param('importId') importId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.complete(project.projectId, this.parseImportId(importId), actor);
  }

  // sendBeacon-compatible cancel: browser fires this on navigate-away / tab close.
  @Post(':importId/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abort(
    @Param('importId') importId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    await this.service.abort(project.projectId, this.parseImportId(importId), actor);
  }

  @Delete(':importId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteImport(
    @Param('importId') importId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    await this.service.abort(project.projectId, this.parseImportId(importId), actor);
  }

  private parseImportId(importId: string): string {
    const parse = datasetIdParamSchema.safeParse(importId);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return parse.data;
  }
}
