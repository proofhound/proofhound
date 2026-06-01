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
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
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
  async list(@CurrentUser() actor: CurrentUserPayload, @CurrentProject() project: ProjectContext) {
    return this.service.listTasks(project.projectId, actor);
  }

  @Get('options')
  async options(@CurrentUser() actor: CurrentUserPayload, @CurrentProject() project: ProjectContext) {
    return this.service.listOptions(project.projectId, actor);
  }

  @Post()
  async create(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = createAnnotationTaskInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.createTask(project.projectId, parse.data, actor);
  }

  @Get(':taskId')
  async detail(
    @Param('taskId') taskId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.service.getTask(project.projectId, this.parseUuid(taskId), actor);
  }

  @Get(':taskId/samples')
  async samples(
    @Param('taskId') taskId: string,
    @Query() rawQuery: Record<string, string>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = sampleListQuerySchema.safeParse(rawQuery);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.listSamples(project.projectId, this.parseUuid(taskId), parse.data, actor);
  }

  @Post(':taskId/samples/claim')
  async claim(
    @Param('taskId') taskId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = claimAnnotationSamplesInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.claimSamples(project.projectId, this.parseUuid(taskId), parse.data, actor);
  }

  @Post(':taskId/samples/submit')
  async submit(
    @Param('taskId') taskId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = submitAnnotationSampleInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.submitSample(project.projectId, this.parseUuid(taskId), parse.data, actor);
  }

  @Post(':taskId/samples/release')
  async release(
    @Param('taskId') taskId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = releaseAnnotationSampleInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.releaseSample(project.projectId, this.parseUuid(taskId), parse.data, actor);
  }

  private parseUuid(value: string): string {
    const parse = uuidSchema.safeParse(value);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
