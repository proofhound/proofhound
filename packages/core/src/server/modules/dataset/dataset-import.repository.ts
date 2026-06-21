import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type { CreateDatasetImportDto, DatasetFieldSchemaDto } from '@proofhound/shared';
import { createLogger } from '@proofhound/logger';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import { ObjectStorageProvider, type StoredObjectRef } from '../../common/contracts/object-storage.provider';
import {
  buildDatasetSampleOffloadRows,
  type OffloadShardManifest,
  type OffloadStagingMetrics,
  type OffloadStagingProgress,
  offloadStagingToShards,
} from './dataset-sample-offload';

const { datasetImports, datasetImportSamples, datasetSamples, datasets, projects } = schema;

// Per-shard batch for offload-at-promote. Bounded so a batch's data stays in memory only briefly
// (large image/base64 samples make per-row size unpredictable); each batch becomes one storage shard.
const PROMOTE_SHARD_BATCH = 200;
export const DEFAULT_DATASET_PROMOTE_STORAGE_CONCURRENCY = 4;
export const MAX_DATASET_PROMOTE_STORAGE_CONCURRENCY = 32;
const PROMOTE_OFFLOAD_PROGRESS_INTERVAL_SHARDS = 100;

export interface DatasetImportRow {
  id: string;
  projectId: string;
  datasetId: string | null;
  name: string;
  description: string | null;
  fieldMappings: unknown;
  fileName: string;
  fileSizeBytes: number;
  contentType: string | null;
  sourceFormat: string;
  declaredTotalRows: number | null;
  receivedRows: number;
  errorCode: string | null;
  errorMessage: string | null;
  status: string;
  completedAt: Date | null;
  failedAt: Date | null;
  abortedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDatasetImportArgs {
  importId?: string;
  projectId: string;
  actorUserId: string;
  dto: CreateDatasetImportDto;
  initialStatus?: 'uploading';
}

export interface BatchSampleRow {
  rowIndex: number;
  data: Record<string, unknown>;
  externalId: string | null;
}

export interface PromoteDatasetImportArgs {
  importId: string;
  projectId: string;
  actorUserId: string;
  datasetId: string;
  name: string;
  description: string | null;
  fieldSchema: DatasetFieldSchemaDto[];
  hasImages: boolean;
  onOffloadStarted?: (progress: {
    sampleCount: number;
    batchSize: number;
    totalShards: number;
    concurrency: number;
  }) => void;
  onOffloadProgress?: (progress: OffloadStagingProgress) => void;
  onCleanupFailed?: (error: { refs: StoredObjectRef[]; error: Error }) => void;
}

export interface PromoteDatasetImportMetrics {
  preflightMs: number;
  offloadMs: number;
  commitMs: number;
  datasetSamplesInsertMs: number;
  offload: OffloadStagingMetrics | null;
}

export interface PromoteDatasetImportResult {
  sampleCount: number;
  metrics: PromoteDatasetImportMetrics;
}

// Thrown inside the promote transaction so the caller can map to the right HTTP status while the tx rolls back.
export class DatasetImportEmptyError extends Error {}
export class DatasetNameTakenError extends Error {}
export class DatasetImportInvalidStateError extends Error {}
export class DatasetImportOffloadError extends Error {}

@Injectable()
export class DatasetImportRepository {
  private readonly logger = createLogger('dataset-import.repository', { service: 'server' });

  constructor(
    @Inject(DATABASE_CLIENT) private readonly db: DbClient,
    private readonly storage: ObjectStorageProvider,
  ) {}

  async findProjectAccess(projectId: string): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async isDatasetNameTaken(projectId: string, name: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: datasets.id })
      .from(datasets)
      .where(and(eq(datasets.projectId, projectId), eq(datasets.name, name), isNull(datasets.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  async createImport(args: CreateDatasetImportArgs): Promise<DatasetImportRow> {
    const [row] = await this.db
      .insert(datasetImports)
      .values({
        id: args.importId,
        projectId: args.projectId,
        name: args.dto.name,
        description: args.dto.description?.trim() || null,
        fieldMappings: args.dto.fieldMappings,
        fileName: args.dto.sourceFile.fileName,
        fileSizeBytes: args.dto.sourceFile.fileSizeBytes,
        contentType: args.dto.sourceFile.contentType ?? null,
        sourceFormat: args.dto.sourceFormat,
        declaredTotalRows: args.dto.declaredTotalRows ?? null,
        status: args.initialStatus ?? 'uploading',
        createdBy: args.actorUserId,
      })
      .returning();
    if (!row) throw new Error('dataset_import insert returned no row');
    return row as DatasetImportRow;
  }

  async findImportById(projectId: string, importId: string): Promise<DatasetImportRow | null> {
    const rows = await this.db
      .select()
      .from(datasetImports)
      .where(and(eq(datasetImports.projectId, projectId), eq(datasetImports.id, importId)))
      .limit(1);
    return (rows[0] as DatasetImportRow | undefined) ?? null;
  }

  // Idempotent batch append: ON CONFLICT (import_id, row_index) DO NOTHING so resent batches are no-ops.
  async appendBatch(importId: string, rows: BatchSampleRow[], nextReceivedRows: number): Promise<number> {
    const startedAt = Date.now();
    this.logger.debug(
      {
        importId,
        nextReceivedRows,
        rowCount: rows.length,
        rowStart: rows[0]?.rowIndex ?? null,
      },
      'dataset_import_debug.repository.append.start',
    );
    return this.db.transaction(async (tx) => {
      if (rows.length > 0) {
        const insertStartedAt = Date.now();
        await tx
          .insert(datasetImportSamples)
          .values(rows.map((row) => ({ importId, rowIndex: row.rowIndex, data: row.data, externalId: row.externalId })))
          .onConflictDoNothing();
        this.logger.debug(
          {
            elapsedMs: Date.now() - insertStartedAt,
            importId,
            rowCount: rows.length,
          },
          'dataset_import_debug.repository.append.insert_done',
        );
      }
      const updateStartedAt = Date.now();
      const [updated] = await tx
        .update(datasetImports)
        .set({
          receivedRows: sql`GREATEST(${datasetImports.receivedRows}, ${nextReceivedRows})`,
          status: 'importing',
          updatedAt: new Date(),
        })
        .where(eq(datasetImports.id, importId))
        .returning({ receivedRows: datasetImports.receivedRows });
      this.logger.debug(
        {
          elapsedMs: Date.now() - updateStartedAt,
          importId,
          receivedRows: updated?.receivedRows ?? nextReceivedRows,
        },
        'dataset_import_debug.repository.append.update_done',
      );
      this.logger.debug(
        {
          elapsedMs: Date.now() - startedAt,
          importId,
          receivedRows: updated?.receivedRows ?? nextReceivedRows,
          rowCount: rows.length,
        },
        'dataset_import_debug.repository.append.done',
      );
      return updated?.receivedRows ?? nextReceivedRows;
    });
  }

  async getSampleDataForInference(importId: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const rows = await this.db
      .select({ data: datasetImportSamples.data })
      .from(datasetImportSamples)
      .where(eq(datasetImportSamples.importId, importId))
      .orderBy(asc(datasetImportSamples.rowIndex))
      .limit(limit);
    return rows.map((row) =>
      row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {},
    );
  }

  // Two-phase promote: preflight, optional object-storage offload outside a tx, then a short DB-only commit.
  async promote(args: PromoteDatasetImportArgs): Promise<PromoteDatasetImportResult> {
    const promoteStartedAt = Date.now();
    this.logger.debug(
      { datasetId: args.datasetId, importId: args.importId, projectId: args.projectId },
      'dataset_import_debug.repository.promote.start',
    );
    const metrics: PromoteDatasetImportMetrics = {
      preflightMs: 0,
      offloadMs: 0,
      commitMs: 0,
      datasetSamplesInsertMs: 0,
      offload: null,
    };
    const preflightStartedAt = Date.now();
    const { sampleCount } = await this.preflightPromote(args);
    metrics.preflightMs = Date.now() - preflightStartedAt;
    this.logger.debug(
      {
        datasetId: args.datasetId,
        elapsedMs: metrics.preflightMs,
        importId: args.importId,
        projectId: args.projectId,
        sampleCount,
      },
      'dataset_import_debug.repository.promote.preflight_done',
    );

    let offload: {
      manifests: OffloadShardManifest[];
      storagePrefix: string | null;
      refs: StoredObjectRef[];
      metrics: OffloadStagingMetrics;
    } | null = null;

    if (this.storage.isEnabled()) {
      const uploadedRefs: StoredObjectRef[] = [];
      const concurrency = resolveDatasetPromoteStorageConcurrency();
      const totalShards = Math.ceil(sampleCount / PROMOTE_SHARD_BATCH);
      args.onOffloadStarted?.({
        sampleCount,
        batchSize: PROMOTE_SHARD_BATCH,
        totalShards,
        concurrency,
      });
      this.logger.debug(
        {
          batchSize: PROMOTE_SHARD_BATCH,
          concurrency,
          datasetId: args.datasetId,
          importId: args.importId,
          projectId: args.projectId,
          sampleCount,
          totalShards,
        },
        'dataset_import_debug.repository.promote.offload_start',
      );
      const offloadStartedAt = Date.now();
      try {
        const project = { projectId: args.projectId, source: 'local' as const };
        const result = await offloadStagingToShards({
          datasetId: args.datasetId,
          sampleCount,
          batchSize: PROMOTE_SHARD_BATCH,
          concurrency,
          progressIntervalShards: PROMOTE_OFFLOAD_PROGRESS_INTERVAL_SHARDS,
          fieldSchema: args.fieldSchema,
          readBatch: (offset, limit) =>
            this.db
              .select({ data: datasetImportSamples.data, externalId: datasetImportSamples.externalId })
              .from(datasetImportSamples)
              .where(
                and(
                  eq(datasetImportSamples.importId, args.importId),
                  gte(datasetImportSamples.rowIndex, offset),
                  lt(datasetImportSamples.rowIndex, offset + limit),
                ),
              )
              .orderBy(asc(datasetImportSamples.rowIndex))
              .limit(limit),
          putShard: async (name, body) => {
            const ref = await this.storage.putObject(
              { project, resourceType: 'dataset_normalized', resourceId: args.datasetId, name },
              body,
              { codec: 'gzip' },
            );
            uploadedRefs.push(ref);
            return ref;
          },
          onProgress: args.onOffloadProgress,
        });
        offload = {
          manifests: result.manifests,
          storagePrefix: result.storagePrefix,
          refs: uploadedRefs,
          metrics: result.metrics,
        };
        metrics.offload = result.metrics;
        this.logger.debug(
          {
            datasetId: args.datasetId,
            elapsedMs: Date.now() - offloadStartedAt,
            importId: args.importId,
            projectId: args.projectId,
            refs: uploadedRefs.length,
            totalShards,
          },
          'dataset_import_debug.repository.promote.offload_done',
        );
      } catch (error) {
        await this.cleanupUploadedShards(uploadedRefs, args);
        await this.markFailed(
          args.projectId,
          args.importId,
          'dataset_import_offload_failed',
          error instanceof Error ? error.message : String(error),
        );
        throw new DatasetImportOffloadError(error instanceof Error ? error.message : String(error));
      } finally {
        metrics.offloadMs = Date.now() - offloadStartedAt;
      }
    }

    const commitStartedAt = Date.now();
    this.logger.debug(
      { datasetId: args.datasetId, importId: args.importId, projectId: args.projectId },
      'dataset_import_debug.repository.promote.commit_start',
    );
    try {
      await this.db.transaction(async (tx) => {
        const [countRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(datasetImportSamples)
          .where(eq(datasetImportSamples.importId, args.importId));
        const latestSampleCount = Number(countRow?.count ?? 0);
        if (latestSampleCount === 0) throw new DatasetImportEmptyError();
        if (latestSampleCount !== sampleCount) {
          throw new DatasetImportInvalidStateError('dataset_import_changed_during_promote');
        }
        this.logger.debug(
          {
            datasetId: args.datasetId,
            importId: args.importId,
            latestSampleCount,
            projectId: args.projectId,
          },
          'dataset_import_debug.repository.promote.lock_done',
        );

        const taken = await tx
          .select({ id: datasets.id })
          .from(datasets)
          .where(and(eq(datasets.projectId, args.projectId), eq(datasets.name, args.name), isNull(datasets.deletedAt)))
          .limit(1);
        if (taken.length > 0) throw new DatasetNameTakenError();

        await tx.insert(datasets).values({
          id: args.datasetId,
          projectId: args.projectId,
          name: args.name,
          description: args.description,
          sampleCount: latestSampleCount,
          fieldSchema: args.fieldSchema,
          hasImages: args.hasImages,
          storagePrefix: offload?.storagePrefix ?? undefined,
          createdBy: args.actorUserId,
        });

        if (offload) {
          for (const manifest of offload.manifests) {
            const batch = await tx
              .select({ data: datasetImportSamples.data, externalId: datasetImportSamples.externalId })
              .from(datasetImportSamples)
              .where(
                and(
                  eq(datasetImportSamples.importId, args.importId),
                  gte(datasetImportSamples.rowIndex, manifest.rowStart),
                  lt(datasetImportSamples.rowIndex, manifest.rowStart + manifest.rowCount),
                ),
              )
              .orderBy(asc(datasetImportSamples.rowIndex))
              .limit(manifest.rowCount);
            if (batch.length !== manifest.rowCount) {
              throw new DatasetImportInvalidStateError('dataset_import_shard_manifest_mismatch');
            }
            const insertStartedAt = Date.now();
            await tx
              .insert(datasetSamples)
              .values(buildDatasetSampleOffloadRows(args.datasetId, args.fieldSchema, batch, manifest.shardRef));
            metrics.datasetSamplesInsertMs += Date.now() - insertStartedAt;
          }
          this.logger.debug(
            {
              datasetId: args.datasetId,
              importId: args.importId,
              projectId: args.projectId,
              sampleRowsInsertMs: metrics.datasetSamplesInsertMs,
              shardCount: offload.manifests.length,
            },
            'dataset_import_debug.repository.promote.insert_offload_rows_done',
          );
        } else {
          const insertStartedAt = Date.now();
          await tx.execute(sql`
            INSERT INTO ph_assets.dataset_samples (dataset_id, data, external_id)
            SELECT ${args.datasetId}::uuid, data, external_id
            FROM ph_assets.dataset_import_samples
            WHERE import_id = ${args.importId}::uuid
          `);
          metrics.datasetSamplesInsertMs += Date.now() - insertStartedAt;
          this.logger.debug(
            {
              datasetId: args.datasetId,
              elapsedMs: metrics.datasetSamplesInsertMs,
              importId: args.importId,
              projectId: args.projectId,
              sampleCount,
            },
            'dataset_import_debug.repository.promote.insert_inline_rows_done',
          );
        }

        await tx
          .update(datasetImports)
          .set({ status: 'completed', datasetId: args.datasetId, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(datasetImports.id, args.importId));

        await tx.delete(datasetImportSamples).where(eq(datasetImportSamples.importId, args.importId));
        this.logger.debug(
          {
            datasetId: args.datasetId,
            importId: args.importId,
            projectId: args.projectId,
          },
          'dataset_import_debug.repository.promote.clear_staging_done',
        );
      });
    } catch (error) {
      if (offload) await this.cleanupUploadedShards(offload.refs, args);
      throw error;
    } finally {
      metrics.commitMs = Date.now() - commitStartedAt;
    }
    this.logger.debug(
      {
        datasetId: args.datasetId,
        importId: args.importId,
        projectId: args.projectId,
        sampleCount,
        totalMs: Date.now() - promoteStartedAt,
        ...metrics,
      },
      'dataset_import_debug.repository.promote.done',
    );

    return { sampleCount, metrics };
  }

  private async preflightPromote(args: PromoteDatasetImportArgs): Promise<{ sampleCount: number }> {
    const [session] = await this.db
      .select({ status: datasetImports.status })
      .from(datasetImports)
      .where(and(eq(datasetImports.projectId, args.projectId), eq(datasetImports.id, args.importId)))
      .limit(1);
    if (!session || !['uploading', 'importing'].includes(session.status)) {
      throw new DatasetImportInvalidStateError('dataset_import_invalid_state');
    }

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(datasetImportSamples)
      .where(eq(datasetImportSamples.importId, args.importId));
    const sampleCount = Number(countRow?.count ?? 0);
    if (sampleCount === 0) throw new DatasetImportEmptyError();

    const taken = await this.db
      .select({ id: datasets.id })
      .from(datasets)
      .where(and(eq(datasets.projectId, args.projectId), eq(datasets.name, args.name), isNull(datasets.deletedAt)))
      .limit(1);
    if (taken.length > 0) throw new DatasetNameTakenError();

    return { sampleCount };
  }

  private async cleanupUploadedShards(refs: StoredObjectRef[], args: PromoteDatasetImportArgs): Promise<void> {
    if (refs.length === 0) return;
    await this.storage.deleteObjects(refs).catch((error) => {
      args.onCleanupFailed?.({ refs, error: error instanceof Error ? error : new Error(String(error)) });
    });
  }

  async deleteImport(projectId: string, importId: string): Promise<number> {
    const deleted = await this.db
      .delete(datasetImports)
      .where(and(eq(datasetImports.projectId, projectId), eq(datasetImports.id, importId)))
      .returning({ id: datasetImports.id });
    return deleted.length;
  }

  async findStaleImports(olderThan: Date): Promise<DatasetImportRow[]> {
    const rows = await this.db
      .select()
      .from(datasetImports)
      .where(and(sql`${datasetImports.status} IN ('uploading', 'importing')`, lt(datasetImports.updatedAt, olderThan)));
    return rows as DatasetImportRow[];
  }

  async deleteImportsByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const deleted = await this.db
      .delete(datasetImports)
      .where(inArray(datasetImports.id, ids))
      .returning({ id: datasetImports.id });
    return deleted.length;
  }

  async markFailed(projectId: string, importId: string, errorCode: string, errorMessage: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(datasetImports)
      .set({
        status: 'failed',
        errorCode,
        errorMessage: errorMessage.slice(0, 2000),
        failedAt: now,
        updatedAt: now,
      })
      .where(and(eq(datasetImports.projectId, projectId), eq(datasetImports.id, importId)));
    await this.clearStaging(importId);
  }

  async markAborted(projectId: string, importId: string): Promise<DatasetImportRow | null> {
    const now = new Date();
    const [row] = await this.db
      .update(datasetImports)
      .set({
        status: 'aborted',
        abortedAt: now,
        updatedAt: now,
      })
      .where(and(eq(datasetImports.projectId, projectId), eq(datasetImports.id, importId)))
      .returning();
    await this.clearStaging(importId);
    return (row as DatasetImportRow | undefined) ?? null;
  }

  async clearStaging(importId: string): Promise<void> {
    await this.db.delete(datasetImportSamples).where(eq(datasetImportSamples.importId, importId));
  }
}

export function resolveDatasetPromoteStorageConcurrency(
  raw: string | number | undefined = process.env['DATASET_PROMOTE_STORAGE_CONCURRENCY'],
): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0) return DEFAULT_DATASET_PROMOTE_STORAGE_CONCURRENCY;
  return Math.min(value, MAX_DATASET_PROMOTE_STORAGE_CONCURRENCY);
}
