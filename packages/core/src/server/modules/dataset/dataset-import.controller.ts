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
import { createDatasetImportSchema, datasetIdParamSchema, datasetImportBatchSchema } from '@proofhound/shared';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { resolveProjectContext } from '../../common/project-context';
import { DatasetImportService } from './dataset-import.service';

@Controller('dataset-imports')
@UseGuards(HttpActorGuard)
export class DatasetImportController {
  constructor(private readonly service: DatasetImportService) {}

  @Post()
  async createImport(@Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = createDatasetImportSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return this.service.createImport(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Get(':importId')
  async getImport(@Param('importId') importId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.getImport(resolveProjectContext(actor).projectId, this.parseImportId(importId), actor);
  }

  @Post(':importId/batch')
  async appendBatch(
    @Param('importId') importId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = datasetImportBatchSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return this.service.appendBatch(
      resolveProjectContext(actor).projectId,
      this.parseImportId(importId),
      parse.data,
      actor,
    );
  }

  @Post(':importId/complete')
  async complete(@Param('importId') importId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.complete(resolveProjectContext(actor).projectId, this.parseImportId(importId), actor);
  }

  // sendBeacon-compatible cancel: browser fires this on navigate-away / tab close.
  @Post(':importId/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abort(@Param('importId') importId: string, @CurrentUser() actor: CurrentUserPayload) {
    await this.service.abort(resolveProjectContext(actor).projectId, this.parseImportId(importId), actor);
  }

  @Delete(':importId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteImport(@Param('importId') importId: string, @CurrentUser() actor: CurrentUserPayload) {
    await this.service.abort(resolveProjectContext(actor).projectId, this.parseImportId(importId), actor);
  }

  private parseImportId(importId: string): string {
    const parse = datasetIdParamSchema.safeParse(importId);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return parse.data;
  }
}
