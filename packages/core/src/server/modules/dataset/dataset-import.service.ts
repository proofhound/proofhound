import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import {
  DATASET_IMPORT_MAX_FILE_BYTES,
  DATASET_IMPORT_ZIP_MAX_FILE_BYTES,
  type CompleteDatasetImportResponseDto,
  type CreateDatasetImportDto,
  type DatasetFieldMappingDto,
  type DatasetImportBatchDto,
  type DatasetImportBatchResponseDto,
  type DatasetImportStoredSourceFormat,
  type DatasetImportState,
  type DatasetImportStatus,
  type DatasetImportStatusDto,
} from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { QuotaPolicyHook } from '../../common/contracts/quota-policy.hook';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { buildDatasetFieldSchema } from './dataset-field-schema.util';
import {
  DatasetImportEmptyError,
  DatasetImportInvalidStateError,
  DatasetImportOffloadError,
  DatasetImportRepository,
  DatasetNameTakenError,
  type DatasetImportRow,
  type PromoteDatasetImportMetrics,
} from './dataset-import.repository';
import { DatasetService } from './dataset.service';

const TYPE_INFERENCE_SAMPLE_LIMIT = 500;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_STALE_TIMEOUT_MS = 120_000;
const MIN_TICK_MS = 1_000;
const IMAGE_ROLES = new Set(['image', 'image_url', 'image_base64']);

@Injectable()
export class DatasetImportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('dataset-import.service', { service: 'server' });
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly repo: DatasetImportRepository,
    private readonly datasetService: DatasetService,
    private readonly accessControl: AccessControlService,
    private readonly quotaPolicy: QuotaPolicyHook,
  ) {}

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

  async createImport(
    projectId: string,
    dto: CreateDatasetImportDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetImportStatusDto> {
    const startedAt = Date.now();
    this.logger.debug(
      {
        fileName: dto.sourceFile.fileName,
        fileSizeBytes: dto.sourceFile.fileSizeBytes,
        projectId,
        sourceFormat: dto.sourceFormat,
      },
      'dataset_import_debug.service.create.start',
    );
    await this.getWritableProject(projectId, actor);
    this.logger.debug(
      { elapsedMs: Date.now() - startedAt, projectId },
      'dataset_import_debug.service.create.access_done',
    );
    this.assertConsistentMappings(dto);
    this.assertSourceFileSizeWithinLimit(dto);
    if (await this.repo.isDatasetNameTaken(projectId, dto.name)) {
      throw new ConflictException('dataset_name_taken');
    }
    this.logger.debug(
      { elapsedMs: Date.now() - startedAt, projectId },
      'dataset_import_debug.service.create.preflight_done',
    );

    await this.quotaPolicy.assertCanStore({
      actor: toActorContext(actor),
      bytes: nonnegativeInteger(dto.sourceFile.fileSizeBytes),
      project: { projectId, source: 'local' },
      source: 'dataset_import',
    });
    this.logger.debug(
      { elapsedMs: Date.now() - startedAt, projectId },
      'dataset_import_debug.service.create.quota_done',
    );

    const row = await this.repo.createImport({ projectId, actorUserId: actor.sub, dto, initialStatus: 'uploading' });
    this.logger.debug(
      { elapsedMs: Date.now() - startedAt, importId: row.id, projectId },
      'dataset_import_debug.service.create.done',
    );
    return this.toImportItem(row);
  }

  async appendBatch(
    projectId: string,
    importId: string,
    dto: DatasetImportBatchDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetImportBatchResponseDto> {
    const startedAt = Date.now();
    this.logger.debug(
      {
        batchStartIndex: dto.batchStartIndex,
        importId,
        projectId,
        sampleCount: dto.samples.length,
      },
      'dataset_import_debug.service.append.start',
    );
    await this.getWritableProject(projectId, actor);
    this.logger.debug(
      {
        batchStartIndex: dto.batchStartIndex,
        elapsedMs: Date.now() - startedAt,
        importId,
        projectId,
      },
      'dataset_import_debug.service.append.access_done',
    );
    const session = await this.requireImportState(projectId, importId, ['uploading', 'importing']);
    this.logger.debug(
      {
        batchStartIndex: dto.batchStartIndex,
        elapsedMs: Date.now() - startedAt,
        importId,
        projectId,
        receivedRows: session.receivedRows,
        status: session.status,
      },
      'dataset_import_debug.service.append.session_done',
    );

    // Reject gaps so the committed staging rows always form a contiguous [0, receivedRows) prefix.
    if (dto.batchStartIndex > session.receivedRows) {
      throw new BadRequestException({ message: 'dataset_import_batch_gap', receivedRows: session.receivedRows });
    }

    await this.quotaPolicy.assertCanStore({
      actor: toActorContext(actor),
      bytes: utf8JsonBytes(dto.samples),
      project: { projectId, source: 'local' },
      source: 'dataset_import_batch',
    });
    this.logger.debug(
      {
        batchStartIndex: dto.batchStartIndex,
        elapsedMs: Date.now() - startedAt,
        importId,
        projectId,
        sampleCount: dto.samples.length,
      },
      'dataset_import_debug.service.append.quota_done',
    );

    const externalIdField = this.externalIdFieldName(session);
    const rows = dto.samples.map((sample, offset) => ({
      rowIndex: dto.batchStartIndex + offset,
      data: sample,
      externalId: this.getExternalId(sample, externalIdField),
    }));

    const receivedRows = await this.repo.appendBatch(importId, rows, dto.batchStartIndex + dto.samples.length);
    this.logger.debug(
      {
        batchStartIndex: dto.batchStartIndex,
        elapsedMs: Date.now() - startedAt,
        importId,
        projectId,
        receivedRows,
        sampleCount: dto.samples.length,
      },
      'dataset_import_debug.service.append.done',
    );
    return { importId, receivedRows };
  }

  async complete(
    projectId: string,
    importId: string,
    actor: CurrentUserPayload,
  ): Promise<CompleteDatasetImportResponseDto> {
    const startedAt = Date.now();
    this.logger.debug({ importId, projectId }, 'dataset_import_debug.service.complete.start');
    await this.getWritableProject(projectId, actor);
    this.logger.debug(
      { elapsedMs: Date.now() - startedAt, importId, projectId },
      'dataset_import_debug.service.complete.access_done',
    );
    const session = await this.requireImport(projectId, importId);
    this.logger.debug(
      {
        elapsedMs: Date.now() - startedAt,
        importId,
        projectId,
        receivedRows: session.receivedRows,
        status: session.status,
      },
      'dataset_import_debug.service.complete.session_done',
    );
    return this.completeStagedImport(projectId, session, actor);
  }

  // Cancel an in-progress import. Staging rows are cleared best-effort.
  async abort(projectId: string, importId: string, actor: CurrentUserPayload): Promise<void> {
    const startedAt = Date.now();
    this.logger.debug({ importId, projectId }, 'dataset_import_debug.service.abort.start');
    await this.getWritableProject(projectId, actor);
    const row = await this.repo.findImportById(projectId, importId);
    if (!row || row.status === 'completed') return;
    await this.repo.markAborted(projectId, importId);
    this.logger.debug(
      { elapsedMs: Date.now() - startedAt, importId, projectId },
      'dataset_import_debug.service.abort.done',
    );
  }

  async getImport(projectId: string, importId: string, actor: CurrentUserPayload): Promise<DatasetImportStatusDto> {
    await this.getAccessibleProject(projectId, actor);
    const row = await this.repo.findImportById(projectId, importId);
    if (!row) throw new NotFoundException(`Dataset import ${importId} not found`);
    return this.toImportItem(row);
  }

  // Periodic cleanup of abandoned import sessions (user left / crashed / network loss before complete).
  async sweepStaleImports(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const threshold = new Date(Date.now() - this.getStaleTimeoutMs());
      const staleImports = await this.repo.findStaleImports(threshold);
      const ids = staleImports.map((row) => row.id);
      if (ids.length === 0) {
        return;
      }
      await Promise.all(staleImports.map((row) => this.repo.markAborted(row.projectId, row.id)));
      this.logger.info({ aborted: ids.length }, 'dataset_import_sweep_reaped');
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'dataset_import_sweep_failed');
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
    const startedAt = Date.now();
    this.logger.debug({ projectId }, 'dataset_import_debug.service.get_writable_project.start');
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    this.logger.debug(
      { elapsedMs: Date.now() - startedAt, projectId },
      'dataset_import_debug.service.get_writable_project.write_access_done',
    );
    await this.getAccessibleProject(projectId, actor);
    this.logger.debug(
      { elapsedMs: Date.now() - startedAt, projectId },
      'dataset_import_debug.service.get_writable_project.done',
    );
  }

  private async requireImport(projectId: string, importId: string): Promise<DatasetImportRow> {
    const row = await this.repo.findImportById(projectId, importId);
    if (!row) throw new NotFoundException(`Dataset import ${importId} not found`);
    return row;
  }

  private async requireImportState(
    projectId: string,
    importId: string,
    states: DatasetImportState[],
  ): Promise<DatasetImportRow> {
    const row = await this.requireImport(projectId, importId);
    if (!states.includes(row.status as DatasetImportState)) {
      throw new ConflictException('dataset_import_invalid_state');
    }
    return row;
  }

  private assertConsistentMappings(dto: CreateDatasetImportDto): void {
    const expectedCount = dto.fieldMappings.filter((field) => field.role === 'expected').length;
    if (expectedCount > 1) throw new ConflictException('dataset_expected_field_unique');
    const names = dto.fieldMappings.map((field) => field.name);
    if (new Set(names).size !== names.length) throw new ConflictException('dataset_field_mapping_duplicate');
  }

  private assertSourceFileSizeWithinLimit(dto: CreateDatasetImportDto): void {
    const fileSizeBytes = nonnegativeInteger(dto.sourceFile.fileSizeBytes);
    const maxBytes = dto.sourceFormat === 'zip' ? DATASET_IMPORT_ZIP_MAX_FILE_BYTES : DATASET_IMPORT_MAX_FILE_BYTES;
    if (fileSizeBytes > maxBytes) throw new ConflictException('dataset_import_file_too_large');
  }

  private toFieldMappings(session: DatasetImportRow): DatasetFieldMappingDto[] {
    return Array.isArray(session.fieldMappings) ? (session.fieldMappings as DatasetFieldMappingDto[]) : [];
  }

  private externalIdFieldName(session: DatasetImportRow): string | null {
    return this.toFieldMappings(session).find((field) => field.role === 'id')?.name ?? null;
  }

  private getExternalId(sample: Record<string, unknown>, fieldName: string | null): string | null {
    if (!fieldName) return null;
    const value = sample[fieldName];
    if (value === undefined || value === null) return null;
    return String(value);
  }

  private async completeStagedImport(
    projectId: string,
    session: DatasetImportRow,
    actor: CurrentUserPayload,
  ): Promise<DatasetImportStatusDto> {
    if (!['uploading', 'importing'].includes(session.status)) {
      return this.toImportItem(session);
    }
    const completeStartedAt = Date.now();
    const datasetId = randomUUID();
    this.logger.info({ projectId, importId: session.id, datasetId }, 'dataset_import_complete_started');
    try {
      const sampleStartedAt = Date.now();
      const sampleRows = await this.repo.getSampleDataForInference(session.id, TYPE_INFERENCE_SAMPLE_LIMIT);
      this.logger.debug(
        {
          datasetId,
          elapsedMs: Date.now() - sampleStartedAt,
          importId: session.id,
          projectId,
          sampleRows: sampleRows.length,
        },
        'dataset_import_debug.service.complete.sample_inference_done',
      );
      const fieldSchema = buildDatasetFieldSchema(this.toFieldMappings(session), sampleRows);
      const hasImages = fieldSchema.some((field) => IMAGE_ROLES.has(field.role));
      this.logger.debug(
        {
          datasetId,
          fieldCount: fieldSchema.length,
          hasImages,
          importId: session.id,
          projectId,
          totalMs: Date.now() - completeStartedAt,
        },
        'dataset_import_debug.service.complete.schema_done',
      );
      const { sampleCount, metrics } = await this.repo.promote({
        importId: session.id,
        projectId,
        actorUserId: actor.sub,
        datasetId,
        name: session.name,
        description: session.description,
        fieldSchema,
        hasImages,
        onOffloadStarted: (progress) => {
          this.logger.info(
            { projectId, importId: session.id, datasetId, ...progress },
            'dataset_import_offload_started',
          );
        },
        onOffloadProgress: (progress) => {
          this.logger.info(
            { projectId, importId: session.id, datasetId, ...progress },
            'dataset_import_offload_progress',
          );
        },
        onCleanupFailed: ({ refs, error }) => {
          this.logger.warn(
            { projectId, importId: session.id, datasetId, keys: refs.map((ref) => ref.key), error: error.message },
            'dataset_import_offload_cleanup_failed',
          );
        },
      });
      this.logger.debug(
        {
          datasetId,
          importId: session.id,
          projectId,
          sampleCount,
          totalMs: Date.now() - completeStartedAt,
          ...flattenPromoteMetrics(metrics),
        },
        'dataset_import_debug.service.complete.promote_done',
      );
      await this.datasetService.recordDatasetImportCompleted({
        projectId,
        datasetId,
        importId: session.id,
        actorId: actor.sub,
        sampleCount,
      });
      this.logger.debug(
        {
          datasetId,
          importId: session.id,
          projectId,
          sampleCount,
          totalMs: Date.now() - completeStartedAt,
        },
        'dataset_import_debug.service.complete.record_event_done',
      );
      this.logger.info(
        {
          projectId,
          importId: session.id,
          datasetId,
          sampleCount,
          totalMs: Date.now() - completeStartedAt,
          ...flattenPromoteMetrics(metrics),
        },
        'dataset_import_completed',
      );
      const row = await this.repo.findImportById(projectId, session.id);
      return this.toImportItem(row ?? { ...session, datasetId, status: 'completed', receivedRows: sampleCount });
    } catch (error) {
      if (error instanceof DatasetImportEmptyError) throw new BadRequestException('dataset_import_empty');
      if (error instanceof DatasetNameTakenError) throw new ConflictException('dataset_name_taken');
      if (error instanceof DatasetImportInvalidStateError) throw new ConflictException(error.message);
      if (error instanceof DatasetImportOffloadError)
        throw new ServiceUnavailableException('dataset_import_offload_failed');
      throw error;
    }
  }

  private toImportItem(row: DatasetImportRow): DatasetImportStatusDto {
    const state = row.status as DatasetImportStatus;
    const progress = buildImportProgress(row, state);
    return {
      id: row.id,
      projectId: row.projectId,
      datasetId: row.datasetId,
      name: row.name,
      description: row.description,
      fileName: row.fileName,
      fileSizeBytes: Number(row.fileSizeBytes),
      sourceFormat: row.sourceFormat as DatasetImportStoredSourceFormat,
      declaredTotalRows: row.declaredTotalRows,
      receivedRows: row.receivedRows,
      status: state,
      state,
      progress,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
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
}

function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function nonnegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value ?? 0)) : 0;
}

function flattenPromoteMetrics(metrics: PromoteDatasetImportMetrics) {
  return {
    preflightMs: Math.round(metrics.preflightMs),
    offloadMs: Math.round(metrics.offloadMs),
    commitMs: Math.round(metrics.commitMs),
    datasetSamplesInsertMs: Math.round(metrics.datasetSamplesInsertMs),
    offloadShards: metrics.offload?.completedShards ?? 0,
    offloadTotalShards: metrics.offload?.totalShards ?? 0,
    dbReadBatchMs: Math.round(metrics.offload?.dbReadBatchMs ?? 0),
    gzipEncodeMs: Math.round(metrics.offload?.gzipEncodeMs ?? 0),
    storagePutMs: Math.round(metrics.offload?.putMs ?? 0),
    avgPutMs: Math.round(metrics.offload?.avgPutMs ?? 0),
    p95PutMs: Math.round(metrics.offload?.p95PutMs ?? 0),
  };
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function buildImportProgress(row: DatasetImportRow, state: DatasetImportState) {
  const totalBytes = nonnegativeInteger(row.fileSizeBytes);
  const totalRows = row.declaredTotalRows;
  const parsedRows = nonnegativeInteger(row.receivedRows);
  const importedRows = state === 'completed' ? parsedRows : 0;

  let percentage: number | null = null;
  if (state === 'completed') {
    percentage = 100;
  } else if (totalRows && totalRows > 0) {
    percentage = Math.min(99, Math.round((parsedRows / totalRows) * 100));
  }

  return {
    state,
    parsedRows,
    importedRows,
    totalRows,
    totalBytes,
    percentage,
  };
}
