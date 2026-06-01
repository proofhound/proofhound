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
import { resolveProjectContext } from '../../common/project-context';
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
  async listPrompts(@CurrentUser() actor: CurrentUserPayload) {
    return this.promptService.listPrompts(resolveProjectContext(actor).projectId, actor);
  }

  @Get(':promptId')
  async getPrompt(@Param('promptId') promptId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.promptService.getPrompt(resolveProjectContext(actor).projectId, this.parsePromptId(promptId), actor);
  }

  @Get(':promptId/metrics')
  async getPromptMetrics(@Param('promptId') promptId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.promptService.getPromptMetrics(
      resolveProjectContext(actor).projectId,
      this.parsePromptId(promptId),
      actor,
    );
  }

  @Get(':promptId/delete-impact')
  async getPromptDeleteImpact(@Param('promptId') promptId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.promptService.getPromptDeleteImpact(
      resolveProjectContext(actor).projectId,
      this.parsePromptId(promptId),
      actor,
    );
  }

  @Get(':promptId/versions/:versionId/delete-impact')
  async getPromptVersionDeleteImpact(
    @Param('promptId') promptId: string,
    @Param('versionId') versionId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.promptService.getPromptVersionDeleteImpact(
      resolveProjectContext(actor).projectId,
      this.parsePromptId(promptId),
      this.parsePromptVersionId(versionId),
      actor,
    );
  }

  @Post()
  async createPrompt(@Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = createPromptSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.promptService.createPrompt(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Patch(':promptId')
  async updatePrompt(
    @Param('promptId') promptId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = updatePromptSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.promptService.updatePrompt(
      resolveProjectContext(actor).projectId,
      this.parsePromptId(promptId),
      parse.data,
      actor,
    );
  }

  @Patch(':promptId/labels')
  async updateVersionLabel(
    @Param('promptId') promptId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = updatePromptVersionLabelSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.promptService.updateVersionLabel(
      resolveProjectContext(actor).projectId,
      this.parsePromptId(promptId),
      parse.data,
      actor,
    );
  }

  @Post(':promptId/versions')
  async createDraftVersion(
    @Param('promptId') promptId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = createPromptDraftVersionSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.promptService.createDraftVersion(
      resolveProjectContext(actor).projectId,
      this.parsePromptId(promptId),
      parse.data,
      actor,
    );
  }

  @Delete(':promptId/versions/:versionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDraftVersion(
    @Param('promptId') promptId: string,
    @Param('versionId') versionId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    await this.promptService.deleteDraftVersion(
      resolveProjectContext(actor).projectId,
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
  ) {
    const parse = updatePromptDraftVersionSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.promptService.updateDraftVersion(
      resolveProjectContext(actor).projectId,
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
  ) {
    return this.promptTryRunService.tryRun(
      resolveProjectContext(actor).projectId,
      this.parsePromptId(promptId),
      rawBody,
      actor,
    );
  }

  @Delete(':promptId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePrompt(@Param('promptId') promptId: string, @CurrentUser() actor: CurrentUserPayload) {
    await this.promptService.deletePrompt(resolveProjectContext(actor).projectId, this.parsePromptId(promptId), actor);
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
