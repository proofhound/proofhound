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
import { resolveProjectContext } from '../../common/project-context';
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
  ) {
    const query = optimizationListQuerySchema.safeParse({ status, search, sort });
    if (!query.success) {
      throw new BadRequestException(query.error.issues);
    }
    return this.optimizationService.listOptimizations(resolveProjectContext(actor).projectId, actor, query.data);
  }

  @Get(':optimizationId')
  async getOptimization(
    @Param('optimizationId') optimizationId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.optimizationService.getOptimization(
      resolveProjectContext(actor).projectId,
      this.parseOptimizationId(optimizationId),
      actor,
    );
  }

  @Post()
  async createOptimization(
    @Body() body: unknown,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parsed = createOptimizationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.optimizationService.createOptimization(resolveProjectContext(actor).projectId, parsed.data, actor);
  }

  @Post(':optimizationId/actions/:action')
  async controlOptimization(
    @Param('optimizationId') optimizationId: string,
    @Param('action') action: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    const parsedAction = optimizationControlActionSchema.safeParse(action);
    if (!parsedAction.success) {
      throw new BadRequestException(parsedAction.error.issues);
    }
    return this.optimizationService.controlOptimization(
      resolveProjectContext(actor).projectId,
      this.parseOptimizationId(optimizationId),
      parsedAction.data,
      actor,
    );
  }

  @Delete(':optimizationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOptimization(
    @Param('optimizationId') optimizationId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    await this.optimizationService.deleteOptimization(
      resolveProjectContext(actor).projectId,
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
