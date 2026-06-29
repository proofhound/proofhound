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
  UseGuards,
} from '@nestjs/common';
import {
  createPromptDraftVersionSchema,
  createPromptSchema,
  promptIdParamSchema,
  promptVersionIdParamSchema,
  updatePromptDraftVersionSchema,
  updatePromptVersionLabelSchema,
  updatePromptSchema,
} from '@proofhound/shared';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
import { PromptTryRunService } from './prompt-try-run.service';
import { PromptService } from './prompt.service';

@Controller('prompts')
@UseGuards(HttpActorGuard)
export class PromptController {
  constructor(
    private readonly promptService: PromptService,
    private readonly promptTryRunService: PromptTryRunService,
  ) {}

  @Get()
  async listPrompts(@CurrentUser() actor: CurrentUserPayload, @CurrentProject() project: ProjectContext) {
    return this.promptService.listPrompts(project.projectId, actor);
  }

  @Get(':promptId')
  async getPrompt(
    @Param('promptId') promptId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.promptService.getPrompt(project.projectId, this.parsePromptId(promptId), actor);
  }

  @Get(':promptId/metrics')
  async getPromptMetrics(
    @Param('promptId') promptId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.promptService.getPromptMetrics(project.projectId, this.parsePromptId(promptId), actor);
  }

  @Get(':promptId/delete-impact')
  async getPromptDeleteImpact(
    @Param('promptId') promptId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.promptService.getPromptDeleteImpact(project.projectId, this.parsePromptId(promptId), actor);
  }

  @Get(':promptId/versions/:versionId/delete-impact')
  async getPromptVersionDeleteImpact(
    @Param('promptId') promptId: string,
    @Param('versionId') versionId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.promptService.getPromptVersionDeleteImpact(
      project.projectId,
      this.parsePromptId(promptId),
      this.parsePromptVersionId(versionId),
      actor,
    );
  }

  @Post()
  async createPrompt(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = createPromptSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.promptService.createPrompt(project.projectId, parse.data, actor);
  }

  @Patch(':promptId')
  async updatePrompt(
    @Param('promptId') promptId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updatePromptSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.promptService.updatePrompt(project.projectId, this.parsePromptId(promptId), parse.data, actor);
  }

  @Patch(':promptId/archive')
  async archivePrompt(
    @Param('promptId') promptId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.promptService.archivePrompt(project.projectId, this.parsePromptId(promptId), actor);
  }

  @Patch(':promptId/restore')
  async restorePrompt(
    @Param('promptId') promptId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.promptService.restorePrompt(project.projectId, this.parsePromptId(promptId), actor);
  }

  @Patch(':promptId/labels')
  async updateVersionLabel(
    @Param('promptId') promptId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updatePromptVersionLabelSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.promptService.updateVersionLabel(project.projectId, this.parsePromptId(promptId), parse.data, actor);
  }

  @Post(':promptId/versions')
  async createDraftVersion(
    @Param('promptId') promptId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = createPromptDraftVersionSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.promptService.createDraftVersion(project.projectId, this.parsePromptId(promptId), parse.data, actor);
  }

  @Delete(':promptId/versions/:versionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDraftVersion(
    @Param('promptId') promptId: string,
    @Param('versionId') versionId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    await this.promptService.deleteDraftVersion(
      project.projectId,
      this.parsePromptId(promptId),
      this.parsePromptVersionId(versionId),
      actor,
    );
  }

  @Patch(':promptId/versions/:versionId')
  async updateDraftVersion(
    @Param('promptId') promptId: string,
    @Param('versionId') versionId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updatePromptDraftVersionSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.promptService.updateDraftVersion(
      project.projectId,
      this.parsePromptId(promptId),
      this.parsePromptVersionId(versionId),
      parse.data,
      actor,
    );
  }

  @Post(':promptId/try-run')
  async tryRun(
    @Param('promptId') promptId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    // project.orgId is the rate-limit bucket (SPEC 08 §3.7); override-only, undefined in OSS.
    return this.promptTryRunService.tryRun(
      project.projectId,
      this.parsePromptId(promptId),
      rawBody,
      actor,
      project.orgId,
    );
  }

  @Delete(':promptId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePrompt(
    @Param('promptId') promptId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    await this.promptService.deletePrompt(project.projectId, this.parsePromptId(promptId), actor);
  }

  private parsePromptId(promptId: string) {
    const parse = promptIdParamSchema.safeParse(promptId);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return parse.data;
  }

  private parsePromptVersionId(versionId: string) {
    const parse = promptVersionIdParamSchema.safeParse(versionId);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return parse.data;
  }
}
