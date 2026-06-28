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
import type {
  CompleteDatasetImportResponseDto,
  CreateDatasetImportDto,
  CreateRawDatasetImportDto,
  CreateRawDatasetImportResponseDto,
  DatasetFieldMappingDto,
  DatasetImportBatchDto,
  DatasetImportBatchResponseDto,
  DatasetImportProgressPhase,
  DatasetRawImportCapabilitiesDto,
  DatasetImportSourceFormat,
  DatasetImportState,
  DatasetImportStatus,
  DatasetImportStatusDto,
} from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { ObjectStorageProvider } from '../../common/contracts/object-storage.provider';
import { type StoredObjectRef } from '../../common/contracts/object-storage.provider';
import { QuotaPolicyHook } from '../../common/contracts/quota-policy.hook';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { BullmqService } from '../../infrastructure/orchestration';
import { buildDatasetFieldSchema } from './dataset-field-schema.util';
import { DatasetImportRepository } from './dataset-import.repository';
import {
  DatasetImportAbortedError,
  DatasetImportEmptyError,
  DatasetNameTakenError,
  type DatasetImportProgressPatch,
  type DatasetImportRow,
} from './dataset-import.repository';
import { DatasetService } from './dataset.service';

const TYPE_INFERENCE_SAMPLE_LIMIT = 500;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_STALE_TIMEOUT_MS = 120_000;
const DEFAULT_PROMOTION_STALE_TIMEOUT_MS = 5 * 60_000;
const MIN_TICK_MS = 1_000;
const IMAGE_ROLES = new Set(['image', 'image_url', 'image_base64']);
const DEFAULT_DATASET_RAW_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_RAW_UPLOAD_EXPIRES_IN_SECONDS = 60 * 60;
const RAW_IMPORT_JOB_ID_PREFIX = 'dataset-raw-import';

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
    private readonly storage: ObjectStorageProvider,
    private readonly bullmq: BullmqService,
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
    await this.getWritableProject(projectId, actor);
    this.assertConsistentMappings(dto);
    this.assertUploadSizeWithinLimit(dto.sourceFile.fileSizeBytes);
    if (await this.repo.isDatasetNameTaken(projectId, dto.name)) {
      throw new ConflictException('dataset_name_taken');
    }

    await this.quotaPolicy.assertCanStore({
      actor: toActorContext(actor),
      bytes: nonnegativeInteger(dto.sourceFile.fileSizeBytes),
      project: { projectId, source: 'local' },
      source: 'dataset_import',
    });

    const row = await this.repo.createImport({ projectId, actorUserId: actor.sub, dto, initialStatus: 'uploading' });
    return this.toImportItem(row);
  }

  async getRawImportCapabilities(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<DatasetRawImportCapabilitiesDto> {
    await this.getAccessibleProject(projectId, actor);
    return {
      supported: this.storage.isEnabled() && this.storage.supportsClientUploadSessions(),
      maxBytes: this.getRawUploadMaxBytes(),
    };
  }

  async createRawImport(
    projectId: string,
    dto: CreateRawDatasetImportDto,
    actor: CurrentUserPayload,
  ): Promise<CreateRawDatasetImportResponseDto> {
    await this.getWritableProject(projectId, actor);
    this.assertConsistentMappings(dto);
    this.assertUploadSizeWithinLimit(dto.sourceFile.fileSizeBytes);
    if (await this.repo.isDatasetNameTaken(projectId, dto.name)) {
      throw new ConflictException('dataset_name_taken');
    }
    if (!this.storage.isEnabled() || !this.storage.supportsClientUploadSessions()) {
      throw new ServiceUnavailableException('dataset_raw_upload_unavailable');
    }

    await this.quotaPolicy.assertCanStore({
      actor: toActorContext(actor),
      bytes: nonnegativeInteger(dto.sourceFile.fileSizeBytes),
      project: { projectId, source: 'local' },
      source: 'dataset_raw_import',
    });

    const importId = randomUUID();
    const uploadSession = await this.storage.createUploadSession(
      {
        project: { projectId, source: 'local' },
        resourceType: 'dataset_raw',
        resourceId: importId,
        name: this.getRawObjectName(dto),
      },
      {
        contentType: dto.sourceFile.contentType,
        maxBytes: Math.min(dto.sourceFile.fileSizeBytes, this.getRawUploadMaxBytes()),
        expiresInSeconds: DEFAULT_RAW_UPLOAD_EXPIRES_IN_SECONDS,
      },
    );
    if (!uploadSession) {
      throw new ServiceUnavailableException('dataset_raw_upload_unavailable');
    }

    try {
      const row = await this.repo.createImport({
        importId,
        projectId,
        actorUserId: actor.sub,
        dto,
        importMode: 'raw_object',
        rawUploadSession: { sessionId: uploadSession.sessionId, expiresAt: uploadSession.expiresAt },
      });
      return { import: this.toImportItem(row), uploadSession, maxBytes: this.getRawUploadMaxBytes() };
    } catch (error) {
      await this.storage.abortUpload(uploadSession.sessionId).catch(() => undefined);
      throw error;
    }
  }

  async appendBatch(
    projectId: string,
    importId: string,
    dto: DatasetImportBatchDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetImportBatchResponseDto> {
    await this.getWritableProject(projectId, actor);
    const session = await this.requireImportState(projectId, importId, ['uploading', 'importing']);
    if (session.importMode !== 'batch') {
      throw new ConflictException('dataset_import_batch_not_allowed');
    }

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

    const externalIdField = this.externalIdFieldName(session);
    const rows = dto.samples.map((sample, offset) => ({
      rowIndex: dto.batchStartIndex + offset,
      data: sample,
      externalId: this.getExternalId(sample, externalIdField),
    }));

    const receivedRows = await this.repo.appendBatch(importId, rows, dto.batchStartIndex + dto.samples.length);
    return { importId, receivedRows };
  }

  async complete(
    projectId: string,
    importId: string,
    actor: CurrentUserPayload,
  ): Promise<CompleteDatasetImportResponseDto> {
    await this.getWritableProject(projectId, actor);
    const session = await this.requireImport(projectId, importId);

    if (session.importMode === 'batch') {
      return this.completeStagedImport(projectId, session, actor);
    }

    if (['queued', 'parsing', 'importing', 'completed', 'failed', 'aborted'].includes(session.status)) {
      return this.toImportItem(session);
    }
    if (session.status !== 'uploaded') {
      throw new ConflictException('dataset_raw_upload_not_completed');
    }

    await this.quotaPolicy.assertCanStore({
      actor: toActorContext(actor),
      bytes: nonnegativeInteger(session.fileSizeBytes),
      project: { projectId, source: 'local' },
      source: 'dataset_import_complete',
    });

    const jobId = `${RAW_IMPORT_JOB_ID_PREFIX}-${importId}`;
    const queued = await this.repo.markQueued(projectId, importId, jobId);
    if (!queued) throw new ConflictException('dataset_import_not_uploaded');

    try {
      await this.bullmq.enqueueDatasetRawImportJob({ projectId, importId, actorId: actor.sub }, jobId);
    } catch (error) {
      await this.repo.markFailed(projectId, importId, 'dataset_import_enqueue_failed', (error as Error).message);
      throw error;
    }

    this.logger.info({ importId, jobId }, 'dataset_raw_import_queued');
    return this.toImportItem(queued);
  }

  async completeRawUpload(
    projectId: string,
    importId: string,
    actor: CurrentUserPayload,
  ): Promise<DatasetImportStatusDto> {
    await this.getWritableProject(projectId, actor);
    const session = await this.requireImport(projectId, importId);
    if (session.importMode !== 'raw_object') throw new ConflictException('dataset_raw_upload_not_allowed');
    if (['uploaded', 'queued', 'parsing', 'importing', 'completed'].includes(session.status)) {
      return this.toImportItem(session);
    }
    if (session.status !== 'created' && session.status !== 'uploading') {
      throw new ConflictException('dataset_import_not_uploading');
    }
    if (!session.rawUploadSessionId) throw new BadRequestException('dataset_raw_upload_missing_session');

    let finalizedRef: StoredObjectRef | null = null;
    try {
      const ref = await this.storage.completeUpload({
        sessionId: session.rawUploadSessionId,
        actor: toActorContext(actor),
        project: { projectId, source: 'local' },
      });
      finalizedRef = ref;
      this.assertRawObjectWithinLimit(ref);
      await this.quotaPolicy.assertCanStore({
        actor: toActorContext(actor),
        bytes: nonnegativeInteger(ref.bytes),
        project: { projectId, source: 'local' },
        source: 'dataset_raw_import',
      });
      const row = await this.repo.markRawUploadCompleted(projectId, importId, ref);
      if (!row) throw new ConflictException('dataset_import_not_uploading');
      this.logger.info({ importId, bytes: ref.bytes }, 'dataset_raw_upload_completed');
      return this.toImportItem(row);
    } catch (error) {
      await this.repo.markFailed(projectId, importId, 'dataset_raw_upload_complete_failed', (error as Error).message);
      await this.cleanupRawImportResources(finalizedRef ? { ...session, rawObjectRef: finalizedRef } : session);
      throw error;
    }
  }

  // Cancel an in-progress import. Staging rows are cleared and raw transfer resources are removed best-effort.
  async abort(projectId: string, importId: string, actor: CurrentUserPayload): Promise<void> {
    await this.getWritableProject(projectId, actor);
    const row = await this.repo.findImportById(projectId, importId);
    if (!row || row.status === 'completed') return;
    const aborted = await this.repo.markAborted(projectId, importId, { clearStaging: !isPromotionPhase(row.progress) });
    if (!aborted) return;
    await this.cleanupRawImportResources(aborted);
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
        await this.storage.sweepPendingUploads(threshold.toISOString()).catch(() => undefined);
        return;
      }
      const abortedRows = (
        await Promise.all(
          staleImports.map(async (row) => {
            if (row.status === 'aborted') {
              await this.repo.clearStaging(row.id);
              await this.repo.updateProgress(row.projectId, row.id, { cleanupPending: null });
              return row;
            }
            return this.repo.markAborted(row.projectId, row.id);
          }),
        )
      ).filter((row): row is DatasetImportRow => row !== null);
      await Promise.all(abortedRows.map((row) => this.cleanupRawImportResources(row)));
      const pendingUploads = await this.storage.sweepPendingUploads(threshold.toISOString()).catch(() => 0);
      this.logger.info({ aborted: ids.length, pendingUploads }, 'dataset_import_sweep_reaped');
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
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    await this.getAccessibleProject(projectId, actor);
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
    const promoting = await this.repo.markPromoting(projectId, session.id, {
      stalePromotionBefore: new Date(Date.now() - this.getPromotionStaleTimeoutMs()),
    });
    if (!promoting) {
      const latest = await this.repo.findImportById(projectId, session.id);
      if (latest) return this.toImportItem(latest);
      throw new NotFoundException(`Dataset import ${session.id} not found`);
    }
    try {
      const sampleRows = await this.repo.getSampleDataForInference(promoting.id, TYPE_INFERENCE_SAMPLE_LIMIT);
      const fieldSchema = buildDatasetFieldSchema(this.toFieldMappings(promoting), sampleRows);
      const hasImages = fieldSchema.some((field) => IMAGE_ROLES.has(field.role));
      const datasetId = randomUUID();
      const { sampleCount } = await this.repo.promote({
        importId: promoting.id,
        projectId,
        actorUserId: actor.sub,
        datasetId,
        name: promoting.name,
        description: promoting.description,
        fieldSchema,
        hasImages,
        onProgress: (progress) => this.repo.updateProgress(projectId, promoting.id, progress),
      });
      await this.datasetService.recordDatasetImportCompleted({
        projectId,
        datasetId,
        importId: promoting.id,
        actorId: actor.sub,
        sampleCount,
      });
      this.logger.info({ importId: promoting.id, datasetId, sampleCount }, 'dataset_import_completed');
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
    } catch (error) {
      if (error instanceof DatasetImportAbortedError) {
        await this.repo.clearStaging(promoting.id);
        await this.cleanupRawImportResources(promoting);
        const latest = await this.repo.findImportById(projectId, promoting.id);
        return this.toImportItem(
          latest ?? {
            ...promoting,
            status: 'aborted',
            progress: { phase: 'aborted' },
            abortedAt: new Date(),
          },
        );
      }

      const failure =
        error instanceof DatasetImportEmptyError
          ? { code: 'dataset_import_empty', response: new BadRequestException('dataset_import_empty') }
          : error instanceof DatasetNameTakenError
            ? { code: 'dataset_name_taken', response: new ConflictException('dataset_name_taken') }
            : null;
      await this.repo.markFailed(
        projectId,
        promoting.id,
        failure?.code ?? 'dataset_import_complete_failed',
        error instanceof Error ? error.message : String(error),
      );
      if (failure) throw failure.response;
      throw error;
    }
  }

  private assertRawObjectWithinLimit(ref: StoredObjectRef): void {
    this.assertUploadSizeWithinLimit(ref.bytes);
  }

  private assertUploadSizeWithinLimit(bytes: number | undefined): void {
    if (nonnegativeInteger(bytes) > this.getRawUploadMaxBytes()) {
      throw new BadRequestException('dataset_raw_upload_too_large');
    }
  }

  private async cleanupRawImportResources(row: DatasetImportRow): Promise<void> {
    if (row.rawUploadSessionId) {
      await this.storage.abortUpload(row.rawUploadSessionId).catch((error) => {
        this.logger.warn({ importId: row.id, error: (error as Error).message }, 'dataset_raw_upload_abort_failed');
      });
    }
    if (row.rawObjectRef) {
      await this.cleanupRawObjectRef(row.rawObjectRef, row.id);
    }
  }

  private async cleanupRawObjectRef(ref: StoredObjectRef, importId: string): Promise<void> {
    await this.storage.deleteObjects([ref]).catch((error) => {
      this.logger.warn({ importId, key: ref.key, error: (error as Error).message }, 'dataset_raw_object_delete_failed');
    });
  }

  private getRawObjectName(dto: CreateDatasetImportDto): string {
    return `input.${dto.sourceFormat}`;
  }

  private toImportItem(row: DatasetImportRow): DatasetImportStatusDto {
    const state = row.status as DatasetImportStatus;
    const progress = buildImportProgress(row, state);
    return {
      id: row.id,
      projectId: row.projectId,
      datasetId: row.datasetId,
      importMode: row.importMode === 'raw_object' ? 'raw_object' : 'batch',
      name: row.name,
      description: row.description,
      fileName: row.fileName,
      fileSizeBytes: Number(row.fileSizeBytes),
      sourceFormat: row.sourceFormat as DatasetImportSourceFormat,
      declaredTotalRows: row.declaredTotalRows,
      receivedRows: row.receivedRows,
      status: state,
      state,
      progress,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      jobId: row.jobId,
      rawUploadCompletedAt: isoOrNull(row.rawUploadCompletedAt),
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

  private getPromotionStaleTimeoutMs(): number {
    const raw = Number(process.env['DATASET_IMPORT_PROMOTION_STALE_TIMEOUT_MS']);
    return Number.isFinite(raw) && raw >= MIN_TICK_MS ? Math.floor(raw) : DEFAULT_PROMOTION_STALE_TIMEOUT_MS;
  }

  private getRawUploadMaxBytes(): number {
    const raw = Number(process.env['DATASET_RAW_UPLOAD_MAX_BYTES']);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DATASET_RAW_UPLOAD_MAX_BYTES;
  }
}

function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function buildImportProgress(row: DatasetImportRow, state: DatasetImportState) {
  const storedProgress = readImportProgress(row.progress);
  const totalBytes = nonnegativeInteger(row.fileSizeBytes);
  const uploadedBytes =
    row.rawObjectRef?.bytes ??
    (['uploaded', 'queued', 'parsing', 'importing', 'completed'].includes(state) ? totalBytes : null);
  const totalRows = row.declaredTotalRows;
  const parsedRows = nonnegativeInteger(row.receivedRows);
  const committedRows = nonnegativeInteger(storedProgress.committedRows);
  const importedRows = state === 'completed' ? Math.max(parsedRows, committedRows) : committedRows;
  const phase = resolveImportProgressPhase(storedProgress.phase, state);
  const totalShards = nullableNonnegativeInteger(storedProgress.totalShards);
  const completedShards = nullableNonnegativeInteger(storedProgress.completedShards);

  let percentage: number | null = progressPercentage({ phase, totalShards, completedShards });
  if (state === 'completed') {
    percentage = 100;
  } else if (percentage === null && totalRows && totalRows > 0) {
    percentage = Math.min(99, Math.round((parsedRows / totalRows) * 100));
  } else if (percentage === null && uploadedBytes !== null && totalBytes > 0) {
    percentage = Math.min(75, Math.round((uploadedBytes / totalBytes) * 75));
  }

  return {
    state,
    phase,
    uploadedBytes,
    parsedRows,
    importedRows,
    totalRows,
    totalBytes,
    totalShards,
    completedShards,
    committedRows,
    percentage,
  };
}

function readImportProgress(progress: unknown): Partial<DatasetImportProgressPatch> {
  return progress !== null && typeof progress === 'object' && !Array.isArray(progress)
    ? (progress as Partial<DatasetImportProgressPatch>)
    : {};
}

function isPromotionPhase(progress: unknown): boolean {
  const phase = readImportProgress(progress).phase;
  return phase === 'finalizing' || phase === 'offloading' || phase === 'committing';
}

function resolveImportProgressPhase(
  phase: Partial<DatasetImportProgressPatch>['phase'],
  state: DatasetImportState,
): DatasetImportProgressPhase {
  return isImportProgressPhase(phase) ? phase : state;
}

function isImportProgressPhase(value: unknown): value is DatasetImportProgressPhase {
  return (
    value === 'created' ||
    value === 'uploading' ||
    value === 'uploaded' ||
    value === 'queued' ||
    value === 'parsing' ||
    value === 'importing' ||
    value === 'finalizing' ||
    value === 'offloading' ||
    value === 'committing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'aborted'
  );
}

function nullableNonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
}

function progressPercentage({
  phase,
  totalShards,
  completedShards,
}: {
  phase: DatasetImportProgressPhase;
  totalShards: number | null;
  completedShards: number | null;
}): number | null {
  if (phase === 'finalizing') return 90;
  if (phase === 'committing') return 98;
  if (phase !== 'offloading') return null;
  if (!totalShards || totalShards <= 0 || completedShards === null) return 90;
  return Math.min(98, Math.max(90, 90 + Math.floor((completedShards / totalShards) * 8)));
}
