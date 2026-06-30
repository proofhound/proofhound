import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import {
  DatasetSampleRepository,
  type DatasetSampleExportBatch,
  type DatasetSampleExportCursor,
  type DatasetSampleRow,
} from './dataset-sample.repository.contract';

const { datasetSamples } = schema;

// OSS default DatasetSampleRepository (08 §3.14): every sample read is inline against
// `ph_assets.dataset_samples.data` — no object storage, no payload-ref, no offload.
@Injectable()
export class LocalDatasetSampleRepository extends DatasetSampleRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {
    super();
  }

  async loadSampleIdBatch(datasetId: string, cursorId: string | null, batchSize: number): Promise<string[]> {
    // Keyset pagination by id: a dataset's samples share created_at (NOW() at insert/promote time), so id alone is a
    // complete, stable total order. Avoids OFFSET's O(n^2) rescans on large datasets.
    const condition =
      cursorId === null
        ? eq(datasetSamples.datasetId, datasetId)
        : and(eq(datasetSamples.datasetId, datasetId), gt(datasetSamples.id, cursorId));
    const rows = await this.db
      .select({ id: datasetSamples.id })
      .from(datasetSamples)
      .where(condition)
      .orderBy(asc(datasetSamples.id))
      .limit(batchSize);
    return rows.map((r) => r.id);
  }

  async readSamplesByIds(sampleIds: string[]): Promise<Array<{ id: string; data: Record<string, unknown> | null }>> {
    if (sampleIds.length === 0) return [];
    const rows = await this.db
      .select({ id: datasetSamples.id, data: datasetSamples.data })
      .from(datasetSamples)
      .where(inArrayUuids(datasetSamples.id, sampleIds));
    return rows.map((r) => ({ id: r.id, data: (r.data as Record<string, unknown> | null) ?? null }));
  }

  async loadDatasetSamples(datasetId: string): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const rows = await this.db
      .select({ id: datasetSamples.id, data: datasetSamples.data })
      .from(datasetSamples)
      .where(eq(datasetSamples.datasetId, datasetId))
      .orderBy(asc(datasetSamples.createdAt), asc(datasetSamples.id));
    return rows.map((r) => ({ id: r.id, data: (r.data as Record<string, unknown> | null) ?? {} }));
  }

  // Server-side paginated browse with optional cross-field search (data::text ILIKE), so the detail page
  // never loads an entire (potentially 100k+ sample) dataset into memory.
  async listDatasetSamplesPage(
    datasetId: string,
    options: { limit: number; offset: number; search?: string },
  ): Promise<{ rows: DatasetSampleRow[]; total: number }> {
    const searchTerm = options.search?.trim();
    // Search matches the inline sample data (SPEC 22 §7.1).
    const where = searchTerm
      ? and(eq(datasetSamples.datasetId, datasetId), sql`${datasetSamples.data}::text ILIKE ${`%${searchTerm}%`}`)
      : eq(datasetSamples.datasetId, datasetId);

    const [rows, countResult] = await Promise.all([
      this.db
        .select()
        .from(datasetSamples)
        .where(where)
        .orderBy(asc(datasetSamples.createdAt), asc(datasetSamples.id))
        .limit(options.limit)
        .offset(options.offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(datasetSamples).where(where),
    ]);

    return { rows, total: Number(countResult[0]?.count ?? 0) };
  }

  async listDatasetSamplesBatch(
    datasetId: string,
    options: { limit: number; cursor?: DatasetSampleExportCursor | null },
  ): Promise<DatasetSampleExportBatch> {
    const cursorWhere = options.cursor
      ? sql`(${datasetSamples.createdAt}, ${datasetSamples.id}) > (${options.cursor.createdAt}::timestamptz, ${options.cursor.id}::uuid)`
      : undefined;
    const where = cursorWhere
      ? and(eq(datasetSamples.datasetId, datasetId), cursorWhere)
      : eq(datasetSamples.datasetId, datasetId);
    const rows = await this.db
      .select()
      .from(datasetSamples)
      .where(where)
      .orderBy(asc(datasetSamples.createdAt), asc(datasetSamples.id))
      .limit(options.limit);

    const last = rows.length >= options.limit ? rows[rows.length - 1] : null;
    return {
      rows,
      nextCursor: last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
    };
  }

  // SQL GROUP BY on the expected-output field so list/detail never load all sample rows into memory.
  // Mirrors DatasetService.toCategoryLabel: only scalar (string/number/boolean), non-blank, trimmed labels count.
  async aggregateCategoryDistribution(
    datasetId: string,
    fieldName: string,
  ): Promise<Array<{ label: string; count: number }>> {
    // Read the field from the inline sample data, scalar only (SPEC 22 §7.1).
    const value = sql<string | null>`${datasetSamples.data} ->> ${fieldName}`;
    const label = sql<string>`btrim(${value})`;
    const rows = await this.db
      .select({ label, count: sql<number>`count(*)::int` })
      .from(datasetSamples)
      .where(
        and(
          eq(datasetSamples.datasetId, datasetId),
          sql`jsonb_typeof(${datasetSamples.data} -> ${fieldName}) IN ('string', 'number', 'boolean')`,
          sql`btrim(${value}) <> ''`,
        ),
      )
      // GROUP BY ordinal: the same ${fieldName} binds to different param positions in select vs group-by,
      // so Postgres won't match the expressions textually. Referencing select column 1 sidesteps that.
      .groupBy(sql`1`);
    return rows.map((row) => ({ label: String(row.label), count: Number(row.count) }));
  }
}

// drizzle-orm does not expose inArray for raw uuid arrays; manually compose a safe IN clause
function inArrayUuids(column: PgColumn, ids: string[]) {
  const params = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return sql`${column} IN (${params})`;
}
