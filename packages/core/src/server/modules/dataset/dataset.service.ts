import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type {
  CreateDatasetDto,
  DatasetCategoryDistributionDto,
  DatasetCreateResponseDto,
  DatasetExportFormatDto,
  DatasetFieldMappingDto,
  DatasetFieldSchemaDto,
  DatasetListItemDto,
  DatasetReferencesDto,
  DatasetSampleDto,
  DatasetSamplesListResponseDto,
  DatasetSamplesQueryDto,
  DatasetStatusDto,
  DeleteDatasetSamplesDto,
  DeleteDatasetSamplesResponseDto,
  ProjectContext,
  UpdateDatasetMetadataDto,
} from '@proofhound/shared';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { QuotaPolicyHook } from '../../common/contracts/quota-policy.hook';
import { UsageMeteringHook } from '../../common/contracts/usage-metering.hook';
import { safeRecordUsageEvent } from '../../common/contracts/usage-metering.hook';
import { DatasetDeletionHook } from './dataset-deletion.hook';
import { buildDatasetFieldSchema } from './dataset-field-schema.util';
import { DatasetRepository } from './dataset.repository';
import { DatasetSampleRepository } from './dataset-sample.repository.contract';
import {
  type DatasetSampleExportCursor,
  type DatasetProjectAccessRow,
  type DatasetRow,
  type DatasetSampleRow,
} from './dataset.repository';

export interface DatasetExportFile {
  fileName: string;
  contentType: string;
  createStream: () => Readable;
  format: DatasetExportFormatDto;
}

/**
 * How the export is delivered to the client. OSS always streams a fresh DB-backed export (`stream`).
 * The `redirect` variant is a reserved delivery shape (a replacement implementation serving payload bytes from
 * object storage via a signed URL); OSS never produces it.
 */
export type DatasetExportDelivery =
  | { kind: 'stream'; file: DatasetExportFile }
  | { kind: 'redirect'; url: string; expiresAt: string };

const DEFAULT_DATASET_RAW_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DATASET_EXPORT_BATCH_SIZE = 500;
const IMAGE_FIELD_SCHEMA_ROLES = new Set<DatasetFieldSchemaDto['role']>(['image', 'image_url', 'image_base64']);

@Injectable()
export class DatasetService {
  private readonly logger = createLogger('dataset.service', { service: 'server' });

  constructor(
    private readonly repo: DatasetRepository,
    private readonly sampleRepo: DatasetSampleRepository,
    private readonly accessControl: AccessControlService,
    private readonly quotaPolicy: QuotaPolicyHook,
    @Inject(DatasetDeletionHook)
    private readonly deletionHook: DatasetDeletionHook,
    @Optional() private readonly usageMetering?: UsageMeteringHook,
  ) {}

  async listDatasets(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<{ data: DatasetListItemDto[]; total: number }> {
    await this.getAccessibleProject(projectId, actor);

    const rows = await this.repo.listDatasets(projectId);
    const distributions = await this.getCategoryDistributions(rows);
    const references = await this.repo.countDatasetReferences(rows.map((row) => row.id));
    const data = rows.map((row) =>
      this.toDatasetListItem(row, distributions.get(row.id), references.get(row.id) ?? this.emptyReferences()),
    );
    return { data, total: data.length };
  }

  /**
   * Whether `name` is free to use for a new dataset in the project — the same project-scoped, non-deleted
   * uniqueness the create / upload paths enforce, exposed so the UI can warn before a file is uploaded.
   */
  async isNameAvailable(projectId: string, name: string, actor: CurrentUserPayload): Promise<boolean> {
    await this.getAccessibleProject(projectId, actor);

    const trimmed = name.trim();
    if (trimmed.length === 0) return false;
    const existing = await this.repo.findDatasetByProjectAndName(projectId, trimmed);
    return existing === null;
  }

  async getDataset(projectId: string, datasetId: string, actor: CurrentUserPayload): Promise<DatasetListItemDto> {
    await this.getAccessibleProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }

    const distribution = await this.getCategoryDistribution(row);
    const references = await this.repo.countDatasetReferences([row.id]);
    return this.toDatasetListItem(row, distribution, references.get(row.id) ?? this.emptyReferences());
  }

  async listDatasetSamples(
    projectId: string,
    datasetId: string,
    actor: CurrentUserPayload,
    query: DatasetSamplesQueryDto,
  ): Promise<DatasetSamplesListResponseDto> {
    await this.getDataset(projectId, datasetId, actor);

    const { rows, total } = await this.sampleRepo.listDatasetSamplesPage(datasetId, {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
      search: query.search,
    });
    return { data: rows.map((row) => this.toDatasetSample(row)), total };
  }

  async exportDataset(
    projectId: string,
    datasetId: string,
    format: DatasetExportFormatDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetExportFile> {
    const dataset = await this.getDataset(projectId, datasetId, actor);
    const columns = format === 'csv' ? await this.getExportColumns(dataset, datasetId) : [];

    return {
      contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      createStream: () => Readable.from(this.streamDatasetExport(datasetId, format, columns)),
      fileName: this.getExportFileName(dataset.name, format),
      format,
    };
  }

  /**
   * Build the export artifact and stream it. OSS keeps every dataset sample inline in PostgreSQL, so
   * the export is always served as a fresh DB-backed stream (no object storage, no signed URLs).
   */
  async exportDatasetForDownload(
    project: ProjectContext,
    datasetId: string,
    format: DatasetExportFormatDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetExportDelivery> {
    const file = await this.exportDataset(project.projectId, datasetId, format, actor);
    return { kind: 'stream', file };
  }

  async createDataset(
    projectId: string,
    dto: CreateDatasetDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetCreateResponseDto> {
    await this.getWritableProject(projectId, actor);
    this.assertConsistentMappings(dto);
    this.assertUploadSourceSizeWithinLimit(dto.uploadSource.fileSizeBytes);

    const existing = await this.repo.findDatasetByProjectAndName(projectId, dto.name);
    if (existing) {
      throw new ConflictException('dataset_name_taken');
    }

    const datasetId = randomUUID();
    const fieldSchema = buildDatasetFieldSchema(dto.fieldMappings, dto.samples);
    const externalIdFieldName = dto.fieldMappings.find((field) => field.role === 'id')?.name ?? null;
    const hasImages = fieldSchema.some((field) => ['image', 'image_url', 'image_base64'].includes(field.role));
    await this.quotaPolicy.assertCanStore({
      actor: toActorContext(actor),
      bytes: estimateDatasetCreateBytes(dto),
      project: { projectId, source: 'local' },
      source: 'dataset_upload',
    });

    const row = await this.repo.createDatasetWithSamples({
      datasetId,
      projectId,
      actorUserId: actor.sub,
      dto,
      fieldSchema,
      hasImages,
      externalIdFieldName,
    });
    await this.recordDatasetStorageEvents(row, actor.sub, 'dataset.created', {
      sampleCount: dto.samples.length,
      uploadFileName: dto.uploadSource.fileName,
      uploadFileSizeBytes: dto.uploadSource.fileSizeBytes ?? null,
    });

    return {
      dataset: this.toDatasetListItem(
        row,
        this.buildCategoryDistribution(
          fieldSchema,
          dto.samples.map((sample) => ({ data: sample })),
        ),
        this.emptyReferences(),
      ),
      sampleCount: dto.samples.length,
    };
  }

  async deleteDatasetSamples(
    projectId: string,
    datasetId: string,
    dto: DeleteDatasetSamplesDto,
    actor: CurrentUserPayload,
  ): Promise<DeleteDatasetSamplesResponseDto> {
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }
    this.assertDatasetActive(row);

    const referencesMap = await this.repo.countDatasetReferences([datasetId]);
    const references = referencesMap.get(datasetId) ?? this.emptyReferences();
    if (references.experiments + references.optimizations > 0) {
      throw new ConflictException('dataset_samples_referenced');
    }

    const result = await this.repo.hardDeleteSamples(datasetId, dto.sampleIds);
    if (result.deleted > 0) {
      await this.repo.decrementDatasetSampleCount(datasetId, result.deleted);
      await this.recordDatasetStorageEvents(row, actor.sub, 'dataset.updated', {
        deletedSamples: result.deleted,
        reason: 'samples_deleted',
      });
    }

    return { deleted: result.deleted };
  }

  async updateDatasetMetadata(
    projectId: string,
    datasetId: string,
    dto: UpdateDatasetMetadataDto,
    actor: CurrentUserPayload,
  ): Promise<DatasetListItemDto> {
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }
    this.assertDatasetActive(row);

    if (dto.name !== row.name) {
      const existing = await this.repo.findDatasetByProjectAndName(projectId, dto.name);
      if (existing && existing.id !== datasetId) {
        throw new ConflictException('dataset_name_taken');
      }
    }

    const fieldSchema = dto.fieldMappings
      ? this.buildUpdatedFieldSchema(row.fieldSchema, dto.fieldMappings)
      : undefined;
    const updateArgs = {
      name: dto.name,
      description: dto.description === undefined ? row.description : dto.description?.trim() || null,
      ...(fieldSchema
        ? {
            fieldSchema,
            hasImages: fieldSchema.some((field) => IMAGE_FIELD_SCHEMA_ROLES.has(field.role)),
          }
        : {}),
    };
    const updated = await this.repo.updateDatasetMetadata(projectId, datasetId, updateArgs);
    if (!updated) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }

    const distribution = await this.getCategoryDistribution(updated);
    const references = await this.repo.countDatasetReferences([datasetId]);
    await this.recordDatasetStorageEvents(updated, actor.sub, 'dataset.updated', {
      previousName: row.name,
      previousDescription: row.description,
      fieldSchemaUpdated: Boolean(fieldSchema),
    });
    return this.toDatasetListItem(updated, distribution, references.get(datasetId) ?? this.emptyReferences());
  }

  async getDatasetDeleteImpact(projectId: string, datasetId: string, actor: CurrentUserPayload) {
    await this.getAccessibleProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }

    return this.deletionHook.prepareDatasetDeletion({ projectId, datasetId });
  }

  async archiveDataset(projectId: string, datasetId: string, actor: CurrentUserPayload): Promise<DatasetListItemDto> {
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }
    if (row.status !== 'archived') {
      await this.repo.archiveDataset(projectId, datasetId);
    }

    return this.getDataset(projectId, datasetId, actor);
  }

  async restoreDataset(projectId: string, datasetId: string, actor: CurrentUserPayload): Promise<DatasetListItemDto> {
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }
    if (row.status !== 'active') {
      await this.repo.restoreDataset(projectId, datasetId);
    }

    return this.getDataset(projectId, datasetId, actor);
  }

  async deleteDataset(projectId: string, datasetId: string, actor: CurrentUserPayload): Promise<void> {
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findDatasetById(projectId, datasetId);
    if (!row) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }

    await this.deletionHook.prepareDatasetDeletion({ projectId, datasetId });

    const result = await this.repo.hardDeleteDataset(projectId, datasetId);
    if (result.deleted === 0) {
      throw new NotFoundException(`Dataset ${datasetId} not found`);
    }
    const deletedAt = new Date();
    await this.recordDatasetStorageEvents({ ...row, updatedAt: deletedAt, deletedAt }, actor.sub, 'dataset.deleted', {
      sampleCount: row.sampleCount,
    });
  }

  async recordDatasetImportCompleted(input: {
    projectId: string;
    datasetId: string;
    importId: string;
    actorId: string;
    sampleCount: number;
  }): Promise<void> {
    if (!this.usageMetering) return;
    await this.recordStorageEvent('dataset_import.completed', input.projectId, input.actorId, input.datasetId, {
      importId: input.importId,
      datasetId: input.datasetId,
      sampleCount: input.sampleCount,
    });
    await this.recordStorageEvent('storage.dirty', input.projectId, input.actorId, input.datasetId, {
      reason: 'dataset_import.completed',
      importId: input.importId,
      datasetId: input.datasetId,
      sampleCount: input.sampleCount,
    });
  }

  private async getAccessibleProject(projectId: string, actor: CurrentUserPayload): Promise<DatasetProjectAccessRow> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const project = await this.repo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }

  private async getWritableProject(projectId: string, actor: CurrentUserPayload): Promise<DatasetProjectAccessRow> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    return this.getAccessibleProject(projectId, actor);
  }

  private async recordDatasetStorageEvents(
    row: DatasetRow,
    actorId: string,
    eventType: 'dataset.created' | 'dataset.updated' | 'dataset.deleted',
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.usageMetering) return;
    await this.recordStorageEvent(eventType, row.projectId, actorId, row.id, {
      datasetId: row.id,
      name: row.name,
      sampleCount: row.sampleCount,
      hasImages: row.hasImages,
      updatedAt: row.updatedAt.toISOString(),
      ...payload,
    });
    await this.recordStorageEvent('storage.dirty', row.projectId, actorId, row.id, {
      reason: eventType,
      datasetId: row.id,
      sampleCount: row.sampleCount,
      updatedAt: row.updatedAt.toISOString(),
      ...payload,
    });
  }

  private async recordStorageEvent(
    eventType: 'storage.dirty' | 'dataset.created' | 'dataset.updated' | 'dataset.deleted' | 'dataset_import.completed',
    projectId: string,
    actorId: string,
    subjectId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.usageMetering) return;
    const suffix =
      typeof payload['updatedAt'] === 'string'
        ? payload['updatedAt']
        : typeof payload['importId'] === 'string'
          ? payload['importId']
          : new Date().toISOString();
    const occurredAt = typeof payload['updatedAt'] === 'string' ? new Date(payload['updatedAt']) : new Date();
    await safeRecordUsageEvent(
      this.usageMetering,
      {
        idempotencyKey: `storage:${eventType}:${subjectId}:${suffix}`,
        dimension: 'storage',
        eventType,
        projectId,
        actorId,
        occurredAt,
        source: 'server',
        payload,
      },
      this.logger,
    );
  }

  private assertConsistentMappings(dto: CreateDatasetDto) {
    const expectedFieldCount = dto.fieldMappings.filter((field) => field.role === 'expected').length;
    if (expectedFieldCount > 1) {
      throw new ConflictException('dataset_expected_field_unique');
    }

    const mappingNames = dto.fieldMappings.map((field) => field.name);
    const uniqueNames = new Set(mappingNames);
    if (uniqueNames.size !== mappingNames.length) {
      throw new ConflictException('dataset_field_mapping_duplicate');
    }

    const firstSample = dto.samples[0] ?? {};
    const missingFields = mappingNames.filter((name) => !(name in firstSample));
    if (missingFields.length > 0) {
      throw new ConflictException(`dataset_field_mapping_missing:${missingFields.join(',')}`);
    }
  }

  private assertUniqueFieldMappings(mappings: DatasetFieldMappingDto[]) {
    const mappingNames = mappings.map((field) => field.name);
    const uniqueNames = new Set(mappingNames);
    if (uniqueNames.size !== mappingNames.length) {
      throw new ConflictException('dataset_field_mapping_duplicate');
    }
  }

  private buildUpdatedFieldSchema(
    currentValue: unknown,
    mappings: DatasetFieldMappingDto[],
  ): DatasetFieldSchemaDto[] {
    this.assertUniqueFieldMappings(mappings);

    const currentSchema = this.toFieldSchema(currentValue);
    const currentByName = new Map(currentSchema.map((field) => [field.name, field]));

    return mappings.map((field) => {
      const current = currentByName.get(field.name);
      return {
        name: field.name,
        role: this.toUpdatedFieldSchemaRole(field, current?.role),
        type: current?.type ?? 'unknown',
      };
    });
  }

  private toUpdatedFieldSchemaRole(
    field: DatasetFieldMappingDto,
    currentRole: DatasetFieldSchemaDto['role'] | undefined,
  ): DatasetFieldSchemaDto['role'] {
    if (field.role === 'expected') return 'expected_output';
    if (field.role === 'id') return 'metadata';
    if (field.role !== 'image') return field.role;
    return currentRole && IMAGE_FIELD_SCHEMA_ROLES.has(currentRole) ? currentRole : 'image';
  }

  private assertUploadSourceSizeWithinLimit(bytes: number | undefined): void {
    const value = Number.isFinite(bytes) ? Math.max(0, Math.trunc(bytes ?? 0)) : 0;
    if (value > this.getUploadMaxBytes()) {
      throw new ConflictException('dataset_raw_upload_too_large');
    }
  }

  private getUploadMaxBytes(): number {
    const raw = Number(process.env['DATASET_RAW_UPLOAD_MAX_BYTES']);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DATASET_RAW_UPLOAD_MAX_BYTES;
  }

  private toDatasetListItem(
    row: DatasetRow,
    categoryDistribution = this.buildCategoryDistribution(this.toFieldSchema(row.fieldSchema), []),
    references: DatasetReferencesDto = this.emptyReferences(),
  ): DatasetListItemDto {
    const fieldSchema = this.toFieldSchema(row.fieldSchema);

    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      status: this.toDatasetStatus(row.status),
      description: row.description,
      sampleCount: row.sampleCount,
      fieldSchema,
      categoryDistribution,
      references,
      hasImages: row.hasImages,
      createdBy: row.createdBy,
      createdByDisplayName: row.createdByDisplayName ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  private toDatasetStatus(status: string): DatasetStatusDto {
    return status === 'archived' ? 'archived' : 'active';
  }

  private assertDatasetActive(row: DatasetRow): void {
    if (row.status === 'archived') {
      throw new ConflictException('dataset_archived');
    }
  }

  private emptyReferences(): DatasetReferencesDto {
    return { experiments: 0, optimizations: 0 };
  }

  private async getCategoryDistributions(rows: DatasetRow[]) {
    const entries = await Promise.all(
      rows.map(
        async (row): Promise<[string, DatasetCategoryDistributionDto]> => [
          row.id,
          await this.getCategoryDistribution(row),
        ],
      ),
    );
    return new Map(entries);
  }

  // Category distribution comes from a SQL GROUP BY, never an in-memory scan of all samples, so it scales to large datasets.
  private async getCategoryDistribution(row: DatasetRow): Promise<DatasetCategoryDistributionDto> {
    const fieldSchema = this.toFieldSchema(row.fieldSchema);
    const expectedField = this.getExpectedOutputField(fieldSchema);
    if (!expectedField) return { field: null, total: 0, categories: [] };

    const aggregated = await this.sampleRepo.aggregateCategoryDistribution(row.id, expectedField.name);
    return this.toCategoryDistributionDto(expectedField.name, aggregated);
  }

  private toCategoryDistributionDto(
    fieldName: string,
    aggregated: Array<{ label: string; count: number }>,
  ): DatasetCategoryDistributionDto {
    const categories = aggregated
      .map((entry) => ({ label: entry.label, count: entry.count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    return {
      field: fieldName,
      total: categories.reduce((sum, category) => sum + category.count, 0),
      categories,
    };
  }

  private buildCategoryDistribution(
    fieldSchema: DatasetFieldSchemaDto[],
    samples: Array<{ data: unknown }>,
  ): DatasetCategoryDistributionDto {
    const expectedOutputField = this.getExpectedOutputField(fieldSchema);
    if (!expectedOutputField) {
      return { field: null, total: 0, categories: [] };
    }

    const counts = new Map<string, number>();
    for (const sample of samples) {
      const data = this.toRecord(sample.data);
      const label = this.toCategoryLabel(data[expectedOutputField.name]);
      if (!label) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    const categories = [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

    return {
      field: expectedOutputField.name,
      total: categories.reduce((sum, category) => sum + category.count, 0),
      categories,
    };
  }

  private getExpectedOutputField(fieldSchema: DatasetFieldSchemaDto[]) {
    return fieldSchema.find((field) => field.role === 'expected_output') ?? null;
  }

  private toFieldSchema(value: unknown): DatasetFieldSchemaDto[] {
    return Array.isArray(value) ? (value as DatasetFieldSchemaDto[]) : [];
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private toCategoryLabel(value: unknown) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
      const label = value.trim();
      return label.length > 0 ? label : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
  }

  private toDatasetSample(row: DatasetSampleRow): DatasetSampleDto {
    const data =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};

    return {
      id: row.id,
      datasetId: row.datasetId,
      data,
      externalId: row.externalId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async *streamDatasetExport(
    datasetId: string,
    format: DatasetExportFormatDto,
    columns: string[],
  ): AsyncGenerator<string> {
    if (format === 'csv') {
      yield `\uFEFF${columns.map((column) => this.toCsvCell(column)).join(',')}\n`;
    }

    let cursor: DatasetSampleExportCursor | null = null;
    do {
      const batch = await this.sampleRepo.listDatasetSamplesBatch(datasetId, {
        limit: DATASET_EXPORT_BATCH_SIZE,
        cursor,
      });
      for (const row of batch.rows) {
        const sample = this.toDatasetSample(row);
        if (format === 'jsonl') {
          yield `${JSON.stringify(sample.data)}\n`;
          continue;
        }
        yield `${columns.map((column) => this.toCsvCell(sample.data[column])).join(',')}\n`;
      }
      cursor = batch.nextCursor;
    } while (cursor);
  }

  private async getExportColumns(dataset: DatasetListItemDto, datasetId: string) {
    const columns = dataset.fieldSchema.map((field) => field.name);
    const known = new Set(columns);

    let cursor: DatasetSampleExportCursor | null = null;
    do {
      const batch = await this.sampleRepo.listDatasetSamplesBatch(datasetId, {
        limit: DATASET_EXPORT_BATCH_SIZE,
        cursor,
      });
      for (const row of batch.rows) {
        const sample = this.toDatasetSample(row);
        for (const fieldName of Object.keys(sample.data)) {
          if (known.has(fieldName)) continue;
          known.add(fieldName);
          columns.push(fieldName);
        }
      }
      cursor = batch.nextCursor;
    } while (cursor);

    return columns;
  }

  private toCsvCell(value: unknown) {
    const text =
      value === undefined || value === null
        ? ''
        : typeof value === 'object'
          ? (JSON.stringify(value) ?? '')
          : String(value);

    if (!/[",\n\r]/u.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  private getExportFileName(datasetName: string, format: DatasetExportFormatDto) {
    const safeName =
      datasetName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/gu, '-')
        .replace(/^-+|-+$/gu, '') || 'dataset';

    return `${safeName}.${format}`;
  }
}

function estimateDatasetCreateBytes(dto: CreateDatasetDto): number {
  return nonnegativeInteger(dto.uploadSource.fileSizeBytes) + utf8JsonBytes(dto.samples);
}

function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function nonnegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value ?? 0)) : 0;
}
