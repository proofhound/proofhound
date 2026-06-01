import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  cancelCanaryReleaseInputSchema,
  claimCanaryAnnotationsInputSchema,
  createCanaryReleaseInputSchema,
  releaseCanaryAnnotationInputSchema,
  resumeCanaryReleaseInputSchema,
  stopCanaryReleaseInputSchema,
  submitCanaryAnnotationInputSchema,
  updateCanaryTrafficRatioInputSchema,
} from '@proofhound/shared';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { resolveProjectContext } from '../../common/project-context';
import { CanaryReleaseService } from './canary-release.service';

const uuidSchema = z.string().uuid();
const annotationListQuerySchema = z.object({
  status: z.enum(['pending', 'claimed', 'submitted']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const deleteQuerySchema = z.object({
  force: z.coerce.boolean().default(false),
  reason: z.string().max(2000).optional(),
});

@Controller('canary-releases')
@UseGuards(HttpActorGuard)
export class CanaryReleaseController {
  constructor(private readonly service: CanaryReleaseService) {}

  @Get()
  async list(@CurrentUser() actor: CurrentUserPayload) {
    return this.service.list(resolveProjectContext(actor).projectId, actor);
  }

  @Post()
  async create(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = createCanaryReleaseInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.create(resolveProjectContext(actor).projectId, parse.data, actor);
  }

  @Get(':canaryId')
  async detail(
    @Param('canaryId') canaryId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.service.getDetail(resolveProjectContext(actor).projectId, this.parseUuid(canaryId), actor);
  }

  @Post(':canaryId/start')
  async start(
    @Param('canaryId') canaryId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.service.start(resolveProjectContext(actor).projectId, this.parseUuid(canaryId), actor);
  }

  @Post(':canaryId/stop')
  async stop(
    @Param('canaryId') canaryId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = stopCanaryReleaseInputSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.stop(resolveProjectContext(actor).projectId, this.parseUuid(canaryId), actor);
  }

  @Post(':canaryId/resume')
  async resume(
    @Param('canaryId') canaryId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = resumeCanaryReleaseInputSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.resume(resolveProjectContext(actor).projectId, this.parseUuid(canaryId), actor);
  }

  @Post(':canaryId/cancel')
  async cancel(
    @Param('canaryId') canaryId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = cancelCanaryReleaseInputSchema.safeParse(rawBody ?? {});
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.cancel(resolveProjectContext(actor).projectId, this.parseUuid(canaryId), actor);
  }

  @Post(':canaryId/traffic-ratio')
  async updateTrafficRatio(
    @Param('canaryId') canaryId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = updateCanaryTrafficRatioInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.updateTrafficRatio(
      resolveProjectContext(actor).projectId,
      this.parseUuid(canaryId),
      parse.data,
      actor,
    );
  }

  @Delete(':canaryId')
  async softDelete(
    @Param('canaryId') canaryId: string,
    @Query() rawQuery: Record<string, string>,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = deleteQuerySchema.safeParse(rawQuery);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.softDelete(resolveProjectContext(actor).projectId, this.parseUuid(canaryId), parse.data, actor);
  }

  @Get(':canaryId/annotations')
  async listAnnotations(
    @Param('canaryId') canaryId: string,
    @Query() rawQuery: Record<string, string>,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = annotationListQuerySchema.safeParse(rawQuery);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.listAnnotations(resolveProjectContext(actor).projectId, this.parseUuid(canaryId), parse.data, actor);
  }

  @Post(':canaryId/annotations/claim')
  async claimAnnotations(
    @Param('canaryId') canaryId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = claimCanaryAnnotationsInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.claimAnnotations(resolveProjectContext(actor).projectId, this.parseUuid(canaryId), parse.data, actor);
  }

  @Post(':canaryId/annotations/submit')
  async submitAnnotation(
    @Param('canaryId') canaryId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = submitCanaryAnnotationInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.submitAnnotation(resolveProjectContext(actor).projectId, this.parseUuid(canaryId), parse.data, actor);
  }

  @Post(':canaryId/annotations/release')
  async releaseAnnotation(
    @Param('canaryId') canaryId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parse = releaseCanaryAnnotationInputSchema.safeParse(rawBody);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return this.service.releaseAnnotation(resolveProjectContext(actor).projectId, this.parseUuid(canaryId), parse.data, actor);
  }

  private parseUuid(value: string): string {
    const parse = uuidSchema.safeParse(value);
    if (!parse.success) throw new BadRequestException(parse.error.issues);
    return parse.data;
  }
}
