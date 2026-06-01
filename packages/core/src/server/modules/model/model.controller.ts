import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  listModelContextWindowsQuerySchema,
  lookupModelContextWindowQuerySchema,
  upsertModelContextWindowSchema,
} from '@proofhound/shared';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { ModelService } from './model.service';

@Controller('models')
@UseGuards(HttpActorGuard)
export class ModelController {
  constructor(private readonly modelService: ModelService) {}

  @Get('context-windows')
  async listContextWindows(@Query() rawQuery: Record<string, string>) {
    const parse = listModelContextWindowsQuerySchema.safeParse(rawQuery);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.modelService.listContextWindows(parse.data);
  }

  @Get('context-windows/lookup')
  async lookupContextWindow(@Query() rawQuery: Record<string, string>) {
    const parse = lookupModelContextWindowQuerySchema.safeParse(rawQuery);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.modelService.lookupContextWindow(parse.data.providerModelId);
  }

  @Put('context-windows')
  @HttpCode(HttpStatus.OK)
  async upsertContextWindow(@Body() rawBody: unknown, @CurrentUser() actor: CurrentUserPayload) {
    const parse = upsertModelContextWindowSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.modelService.upsertContextWindow(parse.data, actor.sub);
  }
}
