import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type {
  CompleteDatasetImportResponseDto,
  CreateDatasetImportDto,
  DatasetFieldMappingDto,
  DatasetImportBatchDto,
  DatasetImportBatchResponseDto,
  DatasetImportItemDto,
  DatasetImportSourceFormat,
  DatasetImportStatus,
} from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { QuotaPolicyHook } from '../../common/contracts/quota-policy.hook';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { buildDatasetFieldSchema } from './dataset-field-schema.util';
import {
  DatasetImportEmptyError,
  DatasetImportRepository,
  DatasetNameTakenError,
  type BatchSampleRow,
  type DatasetImportRow,
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
  ): Promise<DatasetImportItemDto> {
    await this.getWritableProject(projectId, actor);
    this.assertConsistentMappings(dto);
    if (await this.repo.isDatasetNameTaken(projectId, dto.name)) {
      throw new ConflictException('dataset_name_taken');
    }

    await this.quotaPolicy.assertCanStore({
      actor: toActorContext(actor),
      bytes: nonnegativeInteger(dto.sourceFile.fileSizeBytes),
      project: { projectId, source: 'local' },
      source: 'dataset_import',
    });

    const row = await this.repo.createImport({ projectId, actorUserId: actor.sub, dto });
    return this.toImportItem(row);
  }

  async appendBatch(
    projectId: string,
    importId: string,
    dto: DatasetImportBatchDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetImportBatchResponseDto> {
    await this.getWritableProject(projectId, actor);
    const session = await this.requireImporting(projectId, importId);

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
    const rows: BatchSampleRow[] = dto.samples.map((sample, offset) => ({
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
    const session = await this.requireImporting(projectId, importId);

    const sampleRows = await this.repo.getSampleDataForInference(importId, TYPE_INFERENCE_SAMPLE_LIMIT);
    const fieldSchema = buildDatasetFieldSchema(this.toFieldMappings(session), sampleRows);
    const hasImages = fieldSchema.some((field) => IMAGE_ROLES.has(field.role));
    const datasetId = randomUUID();

    try {
      const { sampleCount } = await this.repo.promote({
        importId,
        projectId,
        actorUserId: actor.sub,
        datasetId,
        name: session.name,
        description: session.description,
        fieldSchema,
        hasImages,
      });
      const dataset = await this.datasetService.getDataset(projectId, datasetId, actor);
      this.logger.info({ importId, datasetId, sampleCount }, 'dataset_import_completed');
      return { dataset, sampleCount };
    } catch (error) {
      if (error instanceof DatasetImportEmptyError) throw new BadRequestException('dataset_import_empty');
      if (error instanceof DatasetNameTakenError) throw new ConflictException('dataset_name_taken');
      throw error;
    }
  }

  // Cancel an in-progress import: delete the session (staging rows cascade). Idempotent — missing session is a no-op.
  async abort(projectId: string, importId: string, actor: CurrentUserPayload): Promise<void> {
    await this.getWritableProject(projectId, actor);
    await this.repo.deleteImport(projectId, importId);
  }

  async getImport(projectId: string, importId: string, actor: CurrentUserPayload): Promise<DatasetImportItemDto> {
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
      const ids = await this.repo.findStaleImportIds(threshold);
      if (ids.length === 0) return;
      const deleted = await this.repo.deleteImportsByIds(ids);
      this.logger.info({ deleted }, 'dataset_import_sweep_reaped');
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

  private async requireImporting(projectId: string, importId: string): Promise<DatasetImportRow> {
    const row = await this.repo.findImportById(projectId, importId);
    if (!row) throw new NotFoundException(`Dataset import ${importId} not found`);
    if (row.status !== 'importing') throw new ConflictException('dataset_import_not_importing');
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

  private toImportItem(row: DatasetImportRow): DatasetImportItemDto {
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
      status: row.status as DatasetImportStatus,
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
