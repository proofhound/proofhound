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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  optimizationControlActionSchema,
  optimizationIdParamSchema,
  optimizationListQuerySchema,
  createOptimizationSchema,
} from '@proofhound/shared';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
import { OptimizationService } from './optimization.service';

@Controller('optimizations')
@UseGuards(HttpActorGuard)
export class OptimizationController {
  constructor(private readonly optimizationService: OptimizationService) {}

  @Get()
  async listOptimizations(
    @Query('status') status: string | undefined,
    @Query('search') search: string | undefined,
    @Query('sort') sort: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const query = optimizationListQuerySchema.safeParse({ status, search, sort });
    if (!query.success) {
      throw new BadRequestException(query.error.issues);
    }
    return this.optimizationService.listOptimizations(project.projectId, actor, query.data);
  }

  @Get(':optimizationId')
  async getOptimization(
    @Param('optimizationId') optimizationId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.optimizationService.getOptimization(project.projectId, this.parseOptimizationId(optimizationId), actor);
  }

  @Post()
  async createOptimization(
    @Body() body: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parsed = createOptimizationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    // project.orgId is the rate-limit bucket (SPEC 08 §3.7); SaaS-only, undefined in OSS.
    return this.optimizationService.createOptimization(project.projectId, parsed.data, actor, 'api', project.orgId);
  }

  @Post(':optimizationId/actions/:action')
  async controlOptimization(
    @Param('optimizationId') optimizationId: string,
    @Param('action') action: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parsedAction = optimizationControlActionSchema.safeParse(action);
    if (!parsedAction.success) {
      throw new BadRequestException(parsedAction.error.issues);
    }
    return this.optimizationService.controlOptimization(
      project.projectId,
      this.parseOptimizationId(optimizationId),
      parsedAction.data,
      actor,
      'api',
      // project.orgId is the rate-limit bucket (SPEC 08 §3.7); SaaS-only, undefined in OSS.
      project.orgId,
    );
  }

  @Delete(':optimizationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOptimization(
    @Param('optimizationId') optimizationId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    await this.optimizationService.deleteOptimization(
      project.projectId,
      this.parseOptimizationId(optimizationId),
      actor,
    );
  }

  private parseOptimizationId(optimizationId: string) {
    const parse = optimizationIdParamSchema.safeParse(optimizationId);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return parse.data;
  }
}
