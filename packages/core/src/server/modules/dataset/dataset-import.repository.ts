import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type { CreateDatasetImportDto, DatasetFieldSchemaDto, DatasetImportProgressPhase } from '@proofhound/shared';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import { ObjectStorageProvider } from '../../common/contracts/object-storage.provider';
import { type StoredObjectRef } from '../../common/contracts/object-storage.provider';
import { offloadStagingToShards } from './dataset-sample-offload';

const { datasetImports, datasetImportSamples, datasetSamples, datasets, projects } = schema;

// Per-shard batch for offload-at-promote. Bounded so a batch's data stays in memory only briefly
// (large image/base64 samples make per-row size unpredictable); each batch becomes one R2 shard.
const PROMOTE_SHARD_BATCH = 200;
const PROMOTION_PHASES = ['finalizing', 'offloading', 'committing'] as const;

export interface DatasetImportProgressPatch {
  phase?: DatasetImportProgressPhase;
  totalShards?: number | null;
  completedShards?: number | null;
  committedRows?: number | null;
  cleanupPending?: number | null;
}

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
  importMode: string;
  rawUploadSessionId: string | null;
  rawUploadExpiresAt: Date | null;
  rawUploadCompletedAt: Date | null;
  rawObjectRef: StoredObjectRef | null;
  progress: unknown;
  declaredTotalRows: number | null;
  receivedRows: number;
  jobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  status: string;
  queuedAt: Date | null;
  startedAt: Date | null;
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
  importMode?: 'batch' | 'raw_object';
  initialStatus?: 'created' | 'uploading';
  rawUploadSession?: {
    sessionId: string;
    expiresAt: string;
  };
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
  onProgress?: (progress: DatasetImportProgressPatch) => Promise<void> | void;
}

// Thrown inside the promote transaction so the caller can map to the right HTTP status while the tx rolls back.
export class DatasetImportEmptyError extends Error {}
export class DatasetNameTakenError extends Error {}
export class DatasetImportAbortedError extends Error {
  constructor() {
    super('dataset_import_aborted');
    this.name = 'DatasetImportAbortedError';
  }
}

@Injectable()
export class DatasetImportRepository {
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
    const initialStatus = args.initialStatus ?? (args.importMode === 'raw_object' ? 'created' : 'uploading');
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
        importMode: args.importMode ?? 'batch',
        rawUploadSessionId: args.rawUploadSession?.sessionId ?? null,
        rawUploadExpiresAt: args.rawUploadSession?.expiresAt ? new Date(args.rawUploadSession.expiresAt) : null,
        declaredTotalRows: args.dto.declaredTotalRows ?? null,
        status: initialStatus,
        progress: { phase: initialStatus },
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
    return this.db.transaction(async (tx) => {
      if (rows.length > 0) {
        await tx
          .insert(datasetImportSamples)
          .values(rows.map((row) => ({ importId, rowIndex: row.rowIndex, data: row.data, externalId: row.externalId })))
          .onConflictDoNothing();
      }
      const [updated] = await tx
        .update(datasetImports)
        .set({
          receivedRows: sql`GREATEST(${datasetImports.receivedRows}, ${nextReceivedRows})`,
          status: 'importing',
          progress: sql`COALESCE(${datasetImports.progress}, '{}'::jsonb) || ${JSON.stringify({
            phase: 'importing',
          })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(datasetImports.id, importId),
            sql`${datasetImports.status} <> 'aborted'`,
            sql`COALESCE(${datasetImports.progress}->>'phase', ${datasetImports.status}) NOT IN (${sql.join(
              PROMOTION_PHASES.map((phase) => sql`${phase}`),
              sql`, `,
            )})`,
          ),
        )
        .returning({ receivedRows: datasetImports.receivedRows });
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

  async markPromoting(projectId: string, importId: string): Promise<DatasetImportRow | null> {
    const now = new Date();
    const [row] = await this.db
      .update(datasetImports)
      .set({
        status: 'importing',
        progress: sql`COALESCE(${datasetImports.progress}, '{}'::jsonb) || ${JSON.stringify({
          phase: 'finalizing',
          totalShards: null,
          completedShards: null,
          committedRows: 0,
        })}::jsonb`,
        updatedAt: now,
      })
      .where(
        and(
          eq(datasetImports.projectId, projectId),
          eq(datasetImports.id, importId),
          sql`${datasetImports.status} IN ('uploading', 'parsing', 'importing')`,
          sql`COALESCE(${datasetImports.progress}->>'phase', ${datasetImports.status}) NOT IN (${sql.join(
            PROMOTION_PHASES.map((phase) => sql`${phase}`),
            sql`, `,
          )})`,
        ),
      )
      .returning();
    return (row as DatasetImportRow | undefined) ?? null;
  }

  // Atomic promote: create the dataset row, bulk-copy staging rows into dataset_samples, mark the session completed, drop staging.
  async promote(args: PromoteDatasetImportArgs): Promise<{ sampleCount: number }> {
    const writtenShardRefs: StoredObjectRef[] = [];
    try {
      return await this.db.transaction(async (tx) => {
        const assertNotAbortRequested = async () => {
          const [importRow] = await tx
            .select({ status: datasetImports.status })
            .from(datasetImports)
            .where(eq(datasetImports.id, args.importId))
            .limit(1);
          if (importRow?.status === 'aborted') throw new DatasetImportAbortedError();
        };

        await assertNotAbortRequested();
        const [countRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(datasetImportSamples)
          .where(eq(datasetImportSamples.importId, args.importId));
        const sampleCount = Number(countRow?.count ?? 0);
        if (sampleCount === 0) throw new DatasetImportEmptyError();
        await args.onProgress?.({ phase: 'finalizing', committedRows: 0 });
        await assertNotAbortRequested();

        const taken = await tx
          .select({ id: datasets.id })
          .from(datasets)
          .where(and(eq(datasets.projectId, args.projectId), eq(datasets.name, args.name), isNull(datasets.deletedAt)))
          .limit(1);
        if (taken.length > 0) throw new DatasetNameTakenError();
        await assertNotAbortRequested();

        await tx.insert(datasets).values({
          id: args.datasetId,
          projectId: args.projectId,
          name: args.name,
          description: args.description,
          sampleCount,
          fieldSchema: args.fieldSchema,
          hasImages: args.hasImages,
          createdBy: args.actorUserId,
        });

        if (this.storage.isEnabled()) {
          // Offload-at-promote (SPEC 22 §7.2): stream staging into shards + projected rows. The pure
          // orchestration lives in dataset-sample-offload.ts; here we just bind the tx / storage I/O.
          const project = { projectId: args.projectId, source: 'local' as const };
          const totalShards = Math.ceil(sampleCount / PROMOTE_SHARD_BATCH);
          await args.onProgress?.({ phase: 'offloading', totalShards, completedShards: 0, committedRows: 0 });
          const { storagePrefix } = await offloadStagingToShards({
            datasetId: args.datasetId,
            sampleCount,
            batchSize: PROMOTE_SHARD_BATCH,
            fieldSchema: args.fieldSchema,
            onProgress: async ({ completedShards, processedRows }) => {
              await args.onProgress?.({
                phase: 'offloading',
                totalShards,
                completedShards,
                committedRows: processedRows,
              });
            },
            readBatch: async (offset, limit) => {
              await assertNotAbortRequested();
              return tx
                .select({ data: datasetImportSamples.data, externalId: datasetImportSamples.externalId })
                .from(datasetImportSamples)
                .where(eq(datasetImportSamples.importId, args.importId))
                .orderBy(asc(datasetImportSamples.rowIndex))
                .limit(limit)
                .offset(offset);
            },
            putShard: (name, body) =>
              this.storage
                .putObject({ project, resourceType: 'dataset_normalized', resourceId: args.datasetId, name }, body, {
                  codec: 'gzip',
                })
                .then((ref) => {
                  writtenShardRefs.push(ref);
                  return ref;
                }),
            insertRows: async (rows) => {
              await assertNotAbortRequested();
              await tx.insert(datasetSamples).values(rows);
            },
          });
          await assertNotAbortRequested();
          if (storagePrefix) {
            await tx.update(datasets).set({ storagePrefix }).where(eq(datasets.id, args.datasetId));
          }
          await args.onProgress?.({
            phase: 'committing',
            totalShards,
            completedShards: totalShards,
            committedRows: sampleCount,
          });
        } else {
          await args.onProgress?.({ phase: 'committing', committedRows: 0 });
          await assertNotAbortRequested();
          await tx.execute(sql`
          INSERT INTO ph_assets.dataset_samples (dataset_id, data, external_id)
          SELECT ${args.datasetId}::uuid, data, external_id
          FROM ph_assets.dataset_import_samples
          WHERE import_id = ${args.importId}::uuid
        `);
        }

        await assertNotAbortRequested();
        const [completed] = await tx
          .update(datasetImports)
          .set({
            status: 'completed',
            datasetId: args.datasetId,
            progress: sql`COALESCE(${datasetImports.progress}, '{}'::jsonb) || ${JSON.stringify({
              phase: 'completed',
              committedRows: sampleCount,
            })}::jsonb`,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(datasetImports.id, args.importId), sql`${datasetImports.status} <> 'aborted'`))
          .returning({ id: datasetImports.id });
        if (!completed) throw new DatasetImportAbortedError();

        await tx.delete(datasetImportSamples).where(eq(datasetImportSamples.importId, args.importId));

        return { sampleCount };
      });
    } catch (error) {
      if (writtenShardRefs.length > 0) {
        await this.storage.deleteObjects(writtenShardRefs).catch(() => undefined);
      }
      throw error;
    }
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
      .where(
        and(
          sql`(${datasetImports.status} IN ('created', 'uploading', 'uploaded') OR (${datasetImports.importMode} = 'batch' AND ${datasetImports.status} = 'importing') OR (${datasetImports.status} = 'aborted' AND ${datasetImports.progress}->>'cleanupPending' = '1'))`,
          sql`COALESCE(${datasetImports.progress}->>'phase', ${datasetImports.status}) NOT IN (${sql.join(
            PROMOTION_PHASES.map((phase) => sql`${phase}`),
            sql`, `,
          )})`,
          lt(datasetImports.updatedAt, olderThan),
        ),
      );
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

  async markRawObjectRef(
    projectId: string,
    importId: string,
    rawObjectRef: StoredObjectRef,
  ): Promise<DatasetImportRow | null> {
    const [row] = await this.db
      .update(datasetImports)
      .set({ rawObjectRef, updatedAt: new Date() })
      .where(and(eq(datasetImports.projectId, projectId), eq(datasetImports.id, importId)))
      .returning();
    return (row as DatasetImportRow | undefined) ?? null;
  }

  async markRawUploadCompleted(
    projectId: string,
    importId: string,
    rawObjectRef: StoredObjectRef,
  ): Promise<DatasetImportRow | null> {
    const now = new Date();
    const [row] = await this.db
      .update(datasetImports)
      .set({
        rawObjectRef,
        status: 'uploaded',
        progress: sql`COALESCE(${datasetImports.progress}, '{}'::jsonb) || ${JSON.stringify({
          phase: 'uploaded',
        })}::jsonb`,
        rawUploadCompletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(datasetImports.projectId, projectId),
          eq(datasetImports.id, importId),
          sql`${datasetImports.status} IN ('created', 'uploading', 'uploaded')`,
        ),
      )
      .returning();
    return (row as DatasetImportRow | undefined) ?? null;
  }

  async markQueued(projectId: string, importId: string, jobId: string): Promise<DatasetImportRow | null> {
    const now = new Date();
    const [row] = await this.db
      .update(datasetImports)
      .set({
        status: 'queued',
        jobId,
        progress: sql`COALESCE(${datasetImports.progress}, '{}'::jsonb) || ${JSON.stringify({
          phase: 'queued',
        })}::jsonb`,
        queuedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(datasetImports.projectId, projectId),
          eq(datasetImports.id, importId),
          sql`${datasetImports.status} IN ('uploaded', 'queued')`,
        ),
      )
      .returning();
    return (row as DatasetImportRow | undefined) ?? null;
  }

  async markParsing(projectId: string, importId: string): Promise<DatasetImportRow | null> {
    const now = new Date();
    const [row] = await this.db
      .update(datasetImports)
      .set({
        status: 'parsing',
        progress: sql`COALESCE(${datasetImports.progress}, '{}'::jsonb) || ${JSON.stringify({
          phase: 'parsing',
        })}::jsonb`,
        startedAt: now,
        updatedAt: now,
        errorCode: null,
        errorMessage: null,
      })
      .where(
        and(
          eq(datasetImports.projectId, projectId),
          eq(datasetImports.id, importId),
          sql`${datasetImports.status} IN ('uploaded', 'queued', 'parsing', 'importing')`,
          sql`COALESCE(${datasetImports.progress}->>'phase', ${datasetImports.status}) NOT IN (${sql.join(
            PROMOTION_PHASES.map((phase) => sql`${phase}`),
            sql`, `,
          )})`,
        ),
      )
      .returning();
    return (row as DatasetImportRow | undefined) ?? null;
  }

  async markFailed(projectId: string, importId: string, errorCode: string, errorMessage: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(datasetImports)
      .set({
        status: 'failed',
        progress: sql`COALESCE(${datasetImports.progress}, '{}'::jsonb) || ${JSON.stringify({
          phase: 'failed',
        })}::jsonb`,
        errorCode,
        errorMessage: errorMessage.slice(0, 2000),
        failedAt: now,
        updatedAt: now,
      })
      .where(and(eq(datasetImports.projectId, projectId), eq(datasetImports.id, importId)));
    await this.clearStaging(importId);
  }

  async markAborted(
    projectId: string,
    importId: string,
    options: { clearStaging?: boolean } = {},
  ): Promise<DatasetImportRow | null> {
    const now = new Date();
    const [row] = await this.db
      .update(datasetImports)
      .set({
        status: 'aborted',
        progress: sql`COALESCE(${datasetImports.progress}, '{}'::jsonb) || ${JSON.stringify({
          phase: 'aborted',
          cleanupPending: options.clearStaging === false ? 1 : null,
        })}::jsonb`,
        abortedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(datasetImports.projectId, projectId),
          eq(datasetImports.id, importId),
          sql`${datasetImports.status} IN ('created', 'uploading', 'uploaded', 'queued', 'parsing', 'importing')`,
        ),
      )
      .returning();
    if (!row) return null;
    if (options.clearStaging !== false) await this.clearStaging(importId);
    return row as DatasetImportRow;
  }

  async clearStaging(importId: string): Promise<void> {
    await this.db.delete(datasetImportSamples).where(eq(datasetImportSamples.importId, importId));
  }

  async updateProgress(projectId: string, importId: string, progress: DatasetImportProgressPatch): Promise<void> {
    const patch = sanitizeProgressPatch(progress);
    const patchKeys = Object.keys(patch);
    const canUpdateAborted =
      patch['phase'] === 'aborted' || (patchKeys.length > 0 && patchKeys.every((key) => key === 'cleanupPending'));
    await this.db
      .update(datasetImports)
      .set({
        progress: sql`COALESCE(${datasetImports.progress}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(datasetImports.projectId, projectId),
          eq(datasetImports.id, importId),
          canUpdateAborted ? sql`TRUE` : sql`${datasetImports.status} <> 'aborted'`,
        ),
      );
  }
}

function sanitizeProgressPatch(progress: DatasetImportProgressPatch): Record<string, string | number | null> {
  return Object.fromEntries(
    Object.entries(progress).filter(
      ([, value]) => value === null || typeof value === 'string' || typeof value === 'number',
    ),
  );
}
