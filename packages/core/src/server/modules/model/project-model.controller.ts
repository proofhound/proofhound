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
  createProjectModelSchema,
  modelDeleteQuerySchema,
  modelIdParamSchema,
  probeDraftProjectModelSchema,
  updateProjectModelSchema,
} from '@proofhound/shared';
import type { Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { resolveProjectContext } from '../../common/project-context';
import { ModelService } from './model.service';

@Controller('models')
@UseGuards(HttpActorGuard)
export class ProjectModelController {
  constructor(private readonly modelService: ModelService) {}

  @Get()
  async list(@CurrentUser() actor: CurrentUserPayload) {
    return this.modelService.listProjectModels(resolveProjectContext(actor).projectId, actor);
  }

  @Get('export')
  async export(
    @CurrentUser() actor: CurrentUserPayload,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.modelService.exportProjectModelsCsv(resolveProjectContext(actor).projectId, actor);
    response.set({
      'Content-Disposition': `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Content-Length': String(file.byteLength),
      'Content-Type': file.contentType,
    });
    return new StreamableFile(file.buffer);
  }

  @Get(':modelId')
  async detail(
    @Param('modelId') modelId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.modelService.getProjectModelDetail(resolveProjectContext(actor).projectId, this.parseModelId(modelId), actor);
  }

  @Get(':modelId/api-key')
  async revealApiKey(
    @Param('modelId') modelId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.modelService.revealProjectApiKey(resolveProjectContext(actor).projectId, this.parseModelId(modelId), actor);
  }

  @Get(':modelId/references')
  async references(
    @Param('modelId') modelId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.modelService.getProjectModelReferences(resolveProjectContext(actor).projectId, this.parseModelId(modelId), actor);
  }

  @Post()
  async create(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = createProjectModelSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.modelService.createProjectModel(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Post('probe-draft')
  async probeDraft(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = probeDraftProjectModelSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.modelService.probeDraftProjectModel(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Patch(':modelId')
  async update(
    @Param('modelId') modelId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = updateProjectModelSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.modelService.updateProjectModel(
      resolveProjectContext(actor).projectId,
      this.parseModelId(modelId),
      parse.data,
      actor,
    );
  }

  @Post(':modelId/probe')
  async probe(
    @Param('modelId') modelId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.modelService.probeProjectModel(resolveProjectContext(actor).projectId, this.parseModelId(modelId), actor);
  }

  @Post(':modelId/duplicate')
  async duplicate(
    @Param('modelId') modelId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.modelService.duplicateProjectModel(resolveProjectContext(actor).projectId, this.parseModelId(modelId), actor);
  }

  @Delete(':modelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('modelId') modelId: string,
    @Query() rawQuery: Record<string, string>,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = modelDeleteQuerySchema.safeParse(rawQuery);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    await this.modelService.deleteProjectModel(
      resolveProjectContext(actor).projectId,
      this.parseModelId(modelId),
      parse.data,
      actor,
    );
  }

  private parseModelId(modelId: string): string {
    const parse = modelIdParamSchema.safeParse(modelId);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
