// LocalDatasetUploadService — OSS default DatasetUploadService (08 §3.13, SPEC 22 §3.1.1).
//
// Receives a Multer temp file, stream-parses it, applies the field mapping, writes bounded staging
// batches, then atomically promotes into a dataset (inline DB). Synchronous in the server process —
// no object storage, no async worker, no client batching. The temp file is deleted in `finally`; a
// startup/periodic sweep reaps staging rows orphaned by a crashed upload request.
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type {
  DatasetFieldMappingDto,
  DatasetImportProgressPhase,
  DatasetImportSourceFormat,
  DatasetImportState,
  DatasetImportStatus,
  DatasetImportStatusDto,
} from '@proofhound/shared';
import { DATASET_UPLOAD_MAX_BYTES } from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { QuotaPolicyHook } from '../../common/contracts/quota-policy.hook';
import { UsageMeteringHook, safeRecordUsageEvent } from '../../common/contracts/usage-metering.hook';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { buildDatasetFieldSchema } from './dataset-field-schema.util';
import {
  DatasetImportAbortedError,
  DatasetImportEmptyError,
  DatasetImportRepository,
  DatasetNameTakenError,
  type BatchSampleRow,
  type DatasetImportRow,
} from './dataset-import.repository';
import { parseRawDatasetRows } from './dataset-import-raw-parser';
import { DatasetUploadService, type DatasetUploadInput } from './dataset-upload.contract';

const TYPE_INFERENCE_SAMPLE_LIMIT = 500;
const STAGING_BATCH_ROWS = 1_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_STALE_TIMEOUT_MS = 120_000;
const MIN_TICK_MS = 1_000;
const IMAGE_ROLES = new Set(['image', 'image_url', 'image_base64']);
const DEFAULT_DATASET_UPLOAD_MAX_BYTES = DATASET_UPLOAD_MAX_BYTES;

@Injectable()
export class LocalDatasetUploadService extends DatasetUploadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('dataset-upload.service', { service: 'server' });
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly repo: DatasetImportRepository,
    private readonly accessControl: AccessControlService,
    private readonly quotaPolicy: QuotaPolicyHook,
    @Optional() private readonly usageMetering?: UsageMeteringHook,
  ) {
    super();
  }

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => void this.sweepStaleImports(), this.getSweepIntervalMs());
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  async uploadDataset(
    projectId: string,
    input: DatasetUploadInput,
    actor: CurrentUserPayload,
  ): Promise<DatasetImportStatusDto> {
    await this.getWritableProject(projectId, actor);
    this.assertConsistentMappings(input.fieldMappings);
    this.assertUploadSizeWithinLimit(input.fileSizeBytes);
    if (await this.repo.isDatasetNameTaken(projectId, input.name)) {
      throw new ConflictException('dataset_name_taken');
    }

    await this.quotaPolicy.assertCanStore({
      actor: toActorContext(actor),
      bytes: nonnegativeInteger(input.fileSizeBytes),
      project: { projectId, source: 'local' },
      source: 'dataset_upload',
    });

    const importRow = await this.repo.createImport({
      projectId,
      actorUserId: actor.sub,
      initialStatus: 'importing',
      dto: {
        name: input.name,
        description: input.description ?? undefined,
        fieldMappings: input.fieldMappings,
        sourceFormat: input.sourceFormat,
        declaredTotalRows: input.declaredTotalRows ?? undefined,
        sourceFile: {
          fileName: input.fileName,
          fileSizeBytes: input.fileSizeBytes,
          contentType: input.contentType ?? undefined,
        },
      },
    });

    try {
      await this.parseFileIntoStaging(importRow, input);
      return await this.promoteUpload(projectId, importRow, input, actor);
    } catch (error) {
      await this.failImport(projectId, importRow.id, error);
      throw this.toHttpError(error);
    } finally {
      await unlink(input.filePath).catch(() => undefined);
    }
  }

  private async parseFileIntoStaging(importRow: DatasetImportRow, input: DatasetUploadInput): Promise<void> {
    const externalIdField = this.externalIdFieldName(input.fieldMappings);
    const selectedColumns = input.fieldMappings.map((field) => field.name);
    const stream = createReadStream(input.filePath);
    let rowIndex = 0;
    let batch: BatchSampleRow[] = [];

    for await (const raw of parseRawDatasetRows(stream, input.sourceFormat)) {
      batch.push({
        rowIndex,
        data: pickSelectedColumns(raw, selectedColumns),
        externalId: getExternalId(raw, externalIdField),
      });
      rowIndex += 1;
      if (batch.length >= STAGING_BATCH_ROWS) {
        await this.repo.appendBatch(importRow.id, batch, rowIndex);
        batch = [];
      }
    }
    if (batch.length > 0) {
      await this.repo.appendBatch(importRow.id, batch, rowIndex);
    }
  }

  private async promoteUpload(
    projectId: string,
    importRow: DatasetImportRow,
    input: DatasetUploadInput,
    actor: CurrentUserPayload,
  ): Promise<DatasetImportStatusDto> {
    const promoting = await this.repo.markPromoting(projectId, importRow.id);
    if (!promoting) {
      const latest = await this.repo.findImportById(projectId, importRow.id);
      if (latest) return this.toImportItem(latest);
      throw new ConflictException('dataset_import_invalid_state');
    }

    const sampleRows = await this.repo.getSampleDataForInference(promoting.id, TYPE_INFERENCE_SAMPLE_LIMIT);
    const fieldSchema = buildDatasetFieldSchema(input.fieldMappings, sampleRows);
    const hasImages = fieldSchema.some((field) => IMAGE_ROLES.has(field.role));
    const datasetId = randomUUID();
    const { sampleCount } = await this.repo.promote({
      importId: promoting.id,
      projectId,
      actorUserId: actor.sub,
      datasetId,
      name: input.name,
      description: input.description ?? null,
      fieldSchema,
      hasImages,
    });
    await this.recordImportCompleted(projectId, datasetId, promoting.id, actor.sub, sampleCount);
    this.logger.info({ importId: promoting.id, datasetId, sampleCount }, 'dataset_upload_completed');

    const row = await this.repo.findImportById(projectId, promoting.id);
    return this.toImportItem(
      row ?? {
        ...promoting,
        datasetId,
        status: 'completed',
        receivedRows: sampleCount,
        progress: { phase: 'completed', committedRows: sampleCount },
      },
    );
  }

  // Emit the same usage-metering events as the dataset service did, so a replacement implementation's billing/usage stays intact.
  // OSS binds NoopUsageMeteringHook, so this is a no-op locally.
  private async recordImportCompleted(
    projectId: string,
    datasetId: string,
    importId: string,
    actorId: string,
    sampleCount: number,
  ): Promise<void> {
    if (!this.usageMetering) return;
    for (const eventType of ['dataset_import.completed', 'storage.dirty'] as const) {
      await safeRecordUsageEvent(
        this.usageMetering,
        {
          idempotencyKey: `storage:${eventType}:${datasetId}:${importId}`,
          dimension: 'storage',
          eventType,
          projectId,
          actorId,
          occurredAt: new Date(),
          source: 'server',
          payload: { reason: 'dataset_import.completed', importId, datasetId, sampleCount },
        },
        this.logger,
      );
    }
  }

  private async failImport(projectId: string, importId: string, error: unknown): Promise<void> {
    const code =
      error instanceof DatasetImportEmptyError
        ? 'dataset_import_empty'
        : error instanceof DatasetNameTakenError
          ? 'dataset_name_taken'
          : 'dataset_upload_failed';
    await this.repo
      .markFailed(projectId, importId, code, error instanceof Error ? error.message : String(error))
      .catch(() => undefined);
  }

  private toHttpError(error: unknown): unknown {
    if (error instanceof DatasetImportEmptyError) return new BadRequestException('dataset_import_empty');
    if (error instanceof DatasetNameTakenError) return new ConflictException('dataset_name_taken');
    if (error instanceof DatasetImportAbortedError) return new ConflictException('dataset_import_aborted');
    return error;
  }

  // Periodic cleanup of staging rows orphaned by a crashed upload request (process died mid-parse).
  async sweepStaleImports(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const threshold = new Date(Date.now() - this.getStaleTimeoutMs());
      const staleImports = await this.repo.findStaleImports(threshold);
      if (staleImports.length === 0) return;
      await Promise.all(
        staleImports.map(async (row) => {
          if (row.status === 'aborted') {
            await this.repo.clearStaging(row.id);
            await this.repo.updateProgress(row.projectId, row.id, { cleanupPending: null });
            return;
          }
          await this.repo.markAborted(row.projectId, row.id);
        }),
      );
      this.logger.info({ reaped: staleImports.length }, 'dataset_upload_sweep_reaped');
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'dataset_upload_sweep_failed');
    } finally {
      this.sweeping = false;
    }
  }

  private async getAccessibleProject(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const project = await this.repo.findProjectAccess(projectId);
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
  }

  private async getWritableProject(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    await this.getAccessibleProject(projectId, actor);
  }

  private assertConsistentMappings(fieldMappings: DatasetFieldMappingDto[]): void {
    const expectedCount = fieldMappings.filter((field) => field.role === 'expected').length;
    if (expectedCount > 1) throw new ConflictException('dataset_expected_field_unique');
    const names = fieldMappings.map((field) => field.name);
    if (new Set(names).size !== names.length) throw new ConflictException('dataset_field_mapping_duplicate');
  }

  private externalIdFieldName(fieldMappings: DatasetFieldMappingDto[]): string | null {
    return fieldMappings.find((field) => field.role === 'id')?.name ?? null;
  }

  private assertUploadSizeWithinLimit(bytes: number | undefined): void {
    if (nonnegativeInteger(bytes) > this.getUploadMaxBytes()) {
      throw new BadRequestException('dataset_upload_too_large');
    }
  }

  private toImportItem(row: DatasetImportRow): DatasetImportStatusDto {
    const state = row.status as DatasetImportStatus;
    return {
      id: row.id,
      projectId: row.projectId,
      datasetId: row.datasetId,
      name: row.name,
      description: row.description,
      fileName: row.fileName,
      fileSizeBytes: Number(row.fileSizeBytes),
      sourceFormat: row.sourceFormat as DatasetImportSourceFormat,
      declaredTotalRows: row.declaredTotalRows,
      receivedRows: row.receivedRows,
      status: state,
      state,
      progress: buildImportProgress(row, state),
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      queuedAt: isoOrNull(row.queuedAt),
      startedAt: isoOrNull(row.startedAt),
      completedAt: isoOrNull(row.completedAt),
      failedAt: isoOrNull(row.failedAt),
      abortedAt: isoOrNull(row.abortedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private getSweepIntervalMs(): number {
    const raw = Number(process.env['DATASET_IMPORT_SWEEP_INTERVAL_MS']);
    return Number.isFinite(raw) && raw >= MIN_TICK_MS ? Math.floor(raw) : DEFAULT_SWEEP_INTERVAL_MS;
  }

  private getStaleTimeoutMs(): number {
    const raw = Number(process.env['DATASET_IMPORT_STALE_TIMEOUT_MS']);
    return Number.isFinite(raw) && raw >= MIN_TICK_MS ? Math.floor(raw) : DEFAULT_STALE_TIMEOUT_MS;
  }

  private getUploadMaxBytes(): number {
    const raw = Number(process.env['DATASET_UPLOAD_MAX_BYTES']);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DATASET_UPLOAD_MAX_BYTES;
  }
}

function pickSelectedColumns(raw: Record<string, unknown>, selected: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of selected) {
    if (name in raw) out[name] = raw[name];
  }
  return out;
}

function getExternalId(sample: Record<string, unknown>, fieldName: string | null): string | null {
  if (!fieldName) return null;
  const value = sample[fieldName];
  if (value === undefined || value === null) return null;
  return String(value);
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function buildImportProgress(row: DatasetImportRow, state: DatasetImportState) {
  const totalBytes = nonnegativeInteger(row.fileSizeBytes);
  const parsedRows = nonnegativeInteger(row.receivedRows);
  const committedRows = state === 'completed' ? parsedRows : 0;
  const phase: DatasetImportProgressPhase = state === 'completed' ? 'completed' : state;
  return {
    state,
    phase,
    uploadedBytes: totalBytes,
    parsedRows,
    importedRows: committedRows,
    totalRows: row.declaredTotalRows,
    totalBytes,
    committedRows,
    percentage: state === 'completed' ? 100 : null,
  };
}
