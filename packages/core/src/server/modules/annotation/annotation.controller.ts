import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  claimAnnotationSamplesInputSchema,
  createAnnotationTaskInputSchema,
  releaseAnnotationSampleInputSchema,
  submitAnnotationSampleInputSchema,
} from '@proofhound/shared';
import { z } from 'zod';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { resolveProjectContext } from '../../common/project-context';
import { AnnotationService } from './annotation.service';

const uuidSchema = z.string().uuid();
const sampleListQuerySchema = z.object({
  status: z.enum(['pending', 'claimed', 'submitted']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80),
  offset: z.coerce.number().int().min(0).default(0),
});

@Controller('annotation-tasks')
@UseGuards(HttpActorGuard)
export class AnnotationController {
  constructor(private readonly service: AnnotationService) {}

  @Get()
  async list(@CurrentUser() actor: CurrentUserPayload) {
    return this.service.listTasks(resolveProjectContext(actor).projectId, actor);
  }

  @Get('options')
  async options(@CurrentUser() actor: CurrentUserPayload) {
    return this.service.listOptions(resolveProjectContext(actor).projectId, actor);
  }

  @Post()
  async create(@Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = createAnnotationTaskInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.createTask(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Get(':taskId')
  async detail(@Param('taskId') taskId: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.service.getTask(resolveProjectContext(actor).projectId, this.parseUuid(taskId), actor);
  }

  @Get(':taskId/samples')
  async samples(
    @Param('taskId') taskId: string,
    @Query() rawQuery: Record<string, string>,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = sampleListQuerySchema.safeParse(rawQuery);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.listSamples(resolveProjectContext(actor).projectId, this.parseUuid(taskId), parse.data, actor);
  }

  @Post(':taskId/samples/claim')
  async claim(@Param('taskId') taskId: string, @Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = claimAnnotationSamplesInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.claimSamples(resolveProjectContext(actor).projectId, this.parseUuid(taskId), parse.data, actor);
  }

  @Post(':taskId/samples/submit')
  async submit(@Param('taskId') taskId: string, @Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = submitAnnotationSampleInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.submitSample(resolveProjectContext(actor).projectId, this.parseUuid(taskId), parse.data, actor);
  }

  @Post(':taskId/samples/release')
  async release(@Param('taskId') taskId: string, @Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = releaseAnnotationSampleInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.releaseSample(
      resolveProjectContext(actor).projectId,
      this.parseUuid(taskId),
      parse.data,
      actor,
    );
  }

  private parseUuid(value: string): string {
    const parse = uuidSchema.safeParse(value);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
