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
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
import { ModelService } from './model.service';

@Controller('models')
@UseGuards(HttpActorGuard)
export class ProjectModelController {
  constructor(private readonly modelService: ModelService) {}

  @Get()
  async list(@CurrentUser() actor: CurrentUserPayload, @CurrentProject() project: ProjectContext) {
    // project.orgId is the rate-limit bucket (SPEC 08 §3.7); override-only, undefined in OSS.
    return this.modelService.listProjectModels(project.projectId, actor, project.orgId);
  }

  @Get('export')
  async export(
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.modelService.exportProjectModelsCsv(project.projectId, actor, project.orgId);
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
    @CurrentProject() project: ProjectContext,
  ) {
    // project.orgId is the rate-limit bucket (SPEC 08 §3.7); override-only, undefined in OSS.
    return this.modelService.getProjectModelDetail(project.projectId, this.parseModelId(modelId), actor, project.orgId);
  }

  @Get(':modelId/api-key')
  async revealApiKey(
    @Param('modelId') modelId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.modelService.revealProjectApiKey(project.projectId, this.parseModelId(modelId), actor);
  }

  @Get(':modelId/references')
  async references(
    @Param('modelId') modelId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.modelService.getProjectModelReferences(project.projectId, this.parseModelId(modelId), actor);
  }

  @Post()
  async create(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = createProjectModelSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    // project.orgId is the rate-limit bucket (SPEC 08 §3.7); override-only, undefined in OSS.
    return this.modelService.createProjectModel(project.projectId, parse.data, actor, 'api', project.orgId);
  }

  @Post('probe-draft')
  async probeDraft(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = probeDraftProjectModelSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    // project.orgId is the rate-limit bucket (SPEC 08 §3.7); override-only, undefined in OSS.
    return this.modelService.probeDraftProjectModel(project.projectId, parse.data, actor, 'api', project.orgId);
  }

  @Patch(':modelId')
  async update(
    @Param('modelId') modelId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updateProjectModelSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    // project.orgId is the rate-limit bucket (SPEC 08 §3.7); override-only, undefined in OSS.
    return this.modelService.updateProjectModel(
      project.projectId,
      this.parseModelId(modelId),
      parse.data,
      actor,
      'api',
      project.orgId,
    );
  }

  @Post(':modelId/probe')
  async probe(
    @Param('modelId') modelId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    // project.orgId is the rate-limit bucket (SPEC 08 §3.7); override-only, undefined in OSS.
    return this.modelService.probeProjectModel(
      project.projectId,
      this.parseModelId(modelId),
      actor,
      'api',
      project.orgId,
    );
  }

  @Post(':modelId/duplicate')
  async duplicate(
    @Param('modelId') modelId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    // project.orgId is the rate-limit bucket (SPEC 08 §3.7); override-only, undefined in OSS.
    return this.modelService.duplicateProjectModel(
      project.projectId,
      this.parseModelId(modelId),
      actor,
      'api',
      project.orgId,
    );
  }

  @Delete(':modelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('modelId') modelId: string,
    @Query() rawQuery: Record<string, string>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = modelDeleteQuerySchema.safeParse(rawQuery);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    await this.modelService.deleteProjectModel(project.projectId, this.parseModelId(modelId), parse.data, actor);
  }

  private parseModelId(modelId: string): string {
    const parse = modelIdParamSchema.safeParse(modelId);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
