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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { tmpdir } from 'node:os';
import { unlink } from 'node:fs/promises';
import {
  DATASET_UPLOAD_MAX_BYTES as DATASET_UPLOAD_MAX_BYTES_DEFAULT,
  createDatasetSchema,
  datasetExportFormatSchema,
  datasetIdParamSchema,
  datasetSamplesQuerySchema,
  datasetUploadMetadataSchema,
  deleteDatasetSamplesSchema,
  updateDatasetMetadataSchema,
} from '@proofhound/shared';
import type { Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { HttpActorGuard } from '../../common/contracts/http-actor.guard';
import { CurrentProject } from '../../common/decorators/current-project.decorator';
import type { ProjectContext } from '@proofhound/shared';
import { DatasetService } from './dataset.service';
import { DatasetUploadService } from './dataset-upload.contract';

// File-size cap for the multipart upload, read once at module load (SPEC 22 §3.1.1). Falls back to
// the shared OSS default so controller validation never diverges from the shared / UI cap.
const DATASET_UPLOAD_MAX_BYTES = (() => {
  const raw = Number(process.env['DATASET_UPLOAD_MAX_BYTES']);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DATASET_UPLOAD_MAX_BYTES_DEFAULT;
})();

/** Minimal Multer file shape (avoids a hard @types/multer dependency). */
interface UploadedDatasetFile {
  path: string;
  originalname: string;
  size: number;
  mimetype?: string;
}

@Controller('datasets')
@UseGuards(HttpActorGuard)
export class DatasetController {
  constructor(
    private readonly datasetService: DatasetService,
    private readonly datasetUpload: DatasetUploadService,
  ) {}

  @Get()
  async listDatasets(@CurrentUser() actor: CurrentUserPayload, @CurrentProject() project: ProjectContext) {
    return this.datasetService.listDatasets(project.projectId, actor);
  }

  @Get(':datasetId/samples')
  async listDatasetSamples(
    @Param('datasetId') datasetId: string,
    @Query() rawQuery: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = datasetSamplesQuerySchema.safeParse(rawQuery);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.listDatasetSamples(project.projectId, this.parseDatasetId(datasetId), actor, parse.data);
  }

  @Get(':datasetId/export')
  async exportDataset(
    @Param('datasetId') datasetId: string,
    @Query('format') format: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parse = datasetExportFormatSchema.safeParse(format ?? 'csv');
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    const delivery = await this.datasetService.exportDatasetForDownload(
      project,
      this.parseDatasetId(datasetId),
      parse.data,
      actor,
    );

    // Object storage minted a signed URL → 302 to it so the bytes are served directly by the store
    // (the existing blob-fetch client transparently follows the redirect). No DTO / client change.
    if (delivery.kind === 'redirect') {
      response.status(HttpStatus.FOUND).set({ Location: delivery.url });
      return undefined;
    }

    const file = delivery.file;
    response.set({
      'Content-Disposition': `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Content-Type': file.contentType,
    });

    return new StreamableFile(file.createStream());
  }

  @Get(':datasetId')
  async getDataset(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.datasetService.getDataset(project.projectId, this.parseDatasetId(datasetId), actor);
  }

  @Get(':datasetId/delete-impact')
  async getDatasetDeleteImpact(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.datasetService.getDatasetDeleteImpact(project.projectId, this.parseDatasetId(datasetId), actor);
  }

  @Post()
  async createDataset(
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = createDatasetSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.createDataset(project.projectId, parse.data, actor);
  }

  // Multipart file upload (OSS UI path): the file streams to a Multer temp file, then the upload
  // adapter parses it synchronously, stages, and promotes into a dataset (SPEC 22 §3.1.1).
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { dest: tmpdir(), limits: { fileSize: DATASET_UPLOAD_MAX_BYTES } }))
  async uploadDataset(
    @UploadedFile() file: UploadedDatasetFile | undefined,
    @Body() rawBody: Record<string, unknown>,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    if (!file) {
      throw new BadRequestException('dataset_upload_file_required');
    }
    const parse = datasetUploadMetadataSchema.safeParse(normalizeUploadMetadata(rawBody));
    if (!parse.success) {
      await unlink(file.path).catch(() => undefined);
      throw new BadRequestException(parse.error.issues);
    }
    return this.datasetUpload.uploadDataset(
      project.projectId,
      {
        filePath: file.path,
        fileName: parse.data.fileName ?? file.originalname,
        fileSizeBytes: file.size,
        contentType: file.mimetype ?? null,
        sourceFormat: parse.data.sourceFormat,
        name: parse.data.name,
        description: parse.data.description ?? null,
        fieldMappings: parse.data.fieldMappings,
        declaredTotalRows: parse.data.declaredTotalRows ?? null,
      },
      actor,
    );
  }

  @Patch(':datasetId')
  async updateDatasetMetadata(
    @Param('datasetId') datasetId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = updateDatasetMetadataSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.updateDatasetMetadata(
      project.projectId,
      this.parseDatasetId(datasetId),
      parse.data,
      actor,
    );
  }

  @Patch(':datasetId/archive')
  async archiveDataset(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.datasetService.archiveDataset(project.projectId, this.parseDatasetId(datasetId), actor);
  }

  @Patch(':datasetId/restore')
  async restoreDataset(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    return this.datasetService.restoreDataset(project.projectId, this.parseDatasetId(datasetId), actor);
  }

  @Delete(':datasetId/samples')
  @HttpCode(HttpStatus.OK)
  async deleteDatasetSamples(
    @Param('datasetId') datasetId: string,
    @Body() rawBody: unknown,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    const parse = deleteDatasetSamplesSchema.safeParse(rawBody);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }

    return this.datasetService.deleteDatasetSamples(
      project.projectId,
      this.parseDatasetId(datasetId),
      parse.data,
      actor,
    );
  }

  @Delete(':datasetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDataset(
    @Param('datasetId') datasetId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @CurrentProject() project: ProjectContext,
  ) {
    await this.datasetService.deleteDataset(project.projectId, this.parseDatasetId(datasetId), actor);
  }

  private parseDatasetId(datasetId: string) {
    const parse = datasetIdParamSchema.safeParse(datasetId);
    if (!parse.success) {
      throw new BadRequestException(parse.error.issues);
    }
    return parse.data;
  }
}

// Multipart text fields arrive as strings; coerce the structured ones before zod validation.
function normalizeUploadMetadata(body: Record<string, unknown>): Record<string, unknown> {
  const declared = body['declaredTotalRows'];
  return {
    ...body,
    fieldMappings: typeof body['fieldMappings'] === 'string' ? safeJsonParse(body['fieldMappings']) : body['fieldMappings'],
    declaredTotalRows: declared != null && declared !== '' ? Number(declared) : undefined,
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
