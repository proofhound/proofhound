import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type { CreateDatasetImportDto, DatasetFieldSchemaDto } from '@proofhound/shared';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import { ObjectStorageProvider, type StoredObjectRef } from '../../common/contracts/object-storage.provider';
import { offloadStagingToShards } from './dataset-sample-offload';

const { datasetImports, datasetImportSamples, datasetSamples, datasets, projects } = schema;

// Per-shard batch for offload-at-promote. Bounded so a batch's data stays in memory only briefly
// (large image/base64 samples make per-row size unpredictable); each batch becomes one R2 shard.
const PROMOTE_SHARD_BATCH = 200;

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
  rawObjectRef: StoredObjectRef | null;
  declaredTotalRows: number | null;
  receivedRows: number;
  status: string;
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
}

// Thrown inside the promote transaction so the caller can map to the right HTTP status while the tx rolls back.
export class DatasetImportEmptyError extends Error {}
export class DatasetNameTakenError extends Error {}

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
          updatedAt: new Date(),
        })
        .where(eq(datasetImports.id, importId))
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

  // Atomic promote: create the dataset row, bulk-copy staging rows into dataset_samples, mark the session ready, drop staging.
  async promote(args: PromoteDatasetImportArgs): Promise<{ sampleCount: number }> {
    return this.db.transaction(async (tx) => {
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(datasetImportSamples)
        .where(eq(datasetImportSamples.importId, args.importId));
      const sampleCount = Number(countRow?.count ?? 0);
      if (sampleCount === 0) throw new DatasetImportEmptyError();

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
        sampleCount,
        fieldSchema: args.fieldSchema,
        hasImages: args.hasImages,
        createdBy: args.actorUserId,
      });

      if (this.storage.isEnabled()) {
        // Offload-at-promote (SPEC 22 §7.2): stream staging into shards + projected rows. The pure
        // orchestration lives in dataset-sample-offload.ts; here we just bind the tx / storage I/O.
        const project = { projectId: args.projectId, source: 'local' as const };
        const { storagePrefix } = await offloadStagingToShards({
          datasetId: args.datasetId,
          sampleCount,
          batchSize: PROMOTE_SHARD_BATCH,
          fieldSchema: args.fieldSchema,
          readBatch: (offset, limit) =>
            tx
              .select({ data: datasetImportSamples.data, externalId: datasetImportSamples.externalId })
              .from(datasetImportSamples)
              .where(eq(datasetImportSamples.importId, args.importId))
              .orderBy(asc(datasetImportSamples.rowIndex))
              .limit(limit)
              .offset(offset),
          putShard: (name, body) =>
            this.storage.putObject(
              { project, resourceType: 'dataset_normalized', resourceId: args.datasetId, name },
              body,
              {
                codec: 'gzip',
              },
            ),
          insertRows: async (rows) => {
            await tx.insert(datasetSamples).values(rows);
          },
        });
        if (storagePrefix) {
          await tx.update(datasets).set({ storagePrefix }).where(eq(datasets.id, args.datasetId));
        }
      } else {
        await tx.execute(sql`
          INSERT INTO ph_assets.dataset_samples (dataset_id, data, external_id)
          SELECT ${args.datasetId}::uuid, data, external_id
          FROM ph_assets.dataset_import_samples
          WHERE import_id = ${args.importId}::uuid
        `);
      }

      await tx
        .update(datasetImports)
        .set({ status: 'ready', datasetId: args.datasetId, updatedAt: new Date() })
        .where(eq(datasetImports.id, args.importId));

      await tx.delete(datasetImportSamples).where(eq(datasetImportSamples.importId, args.importId));

      return { sampleCount };
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
      .where(and(eq(datasetImports.status, 'importing'), lt(datasetImports.updatedAt, olderThan)));
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
}
