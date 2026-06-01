import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { createQuickStartSchema, modelIdParamSchema, probeQuickStartDraftModelSchema } from '@proofhound/shared';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { QuickStartService } from './quick-start.service';

@Controller('quick-start')
@UseGuards(HttpActorGuard)
export class QuickStartController {
  constructor(private readonly quickStart: QuickStartService) {}

  @Get('models')
  async listModels(@CurrentUser() actor: CurrentUserPayload) {
    return this.quickStart.listModelOptions(actor);
  }

  @Post('models/probe-draft')
  async probeDraftModel(@Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = probeQuickStartDraftModelSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.quickStart.probeDraftModel(parse.data, actor);
  }

  @Post('models/:modelId/probe')
  async probeExistingModel(@Param('modelId') modelId: string, @CurrentUser() actor: CurrentUserPayload) {
    const parse = modelIdParamSchema.safeParse(modelId);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.quickStart.probeExistingModel(parse.data, actor);
  }

  @Post()
  async create(@Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = createQuickStartSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.quickStart.createQuickStart(parse.data, actor);
  }
}
