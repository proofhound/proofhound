import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type { CreateDatasetDto, DatasetFieldSchemaDto } from '@proofhound/shared';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

const { optimizations, datasetSamples, datasets, experiments, projects, promptVersions } = schema;

export interface DatasetProjectAccessRow {
  id: string;
}

export interface DatasetRow {
  id: string;
  projectId: string;
  name: string;
  status: string;
  description: string | null;
  sampleCount: number;
  fieldSchema: unknown;
  hasImages: boolean;
  storagePrefix: string | null;
  createdBy: string;
  createdByDisplayName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}

export interface DatasetSampleRow {
  id: string;
  datasetId: string;
  data: unknown;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDatasetRecordArgs {
  datasetId: string;
  projectId: string;
  actorUserId: string;
  dto: CreateDatasetDto;
  fieldSchema: DatasetFieldSchemaDto[];
  hasImages: boolean;
  storagePrefix: string;
  externalIdFieldName: string | null;
}

export interface UpdateDatasetMetadataArgs {
  name: string;
  description: string | null;
}

export interface DatasetDeletionImpactRow {
  id: string;
  name: string | null;
  status: string | null;
  datasetId: string | null;
  promptId: string | null;
  promptVersionId: string | null;
  promptVersionNumber: number | null;
  createdAt: Date | null;
}

export interface DatasetDeletionImpactRows {
  experiments: DatasetDeletionImpactRow[];
  optimizations: DatasetDeletionImpactRow[];
}

@Injectable()
export class DatasetRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  private datasetSelectFields = {
    id: datasets.id,
    projectId: datasets.projectId,
    name: datasets.name,
    status: datasets.status,
    description: datasets.description,
    sampleCount: datasets.sampleCount,
    fieldSchema: datasets.fieldSchema,
    hasImages: datasets.hasImages,
    storagePrefix: datasets.storagePrefix,
    createdBy: datasets.createdBy,
    createdByDisplayName: sql<string | null>`NULL`,
    createdAt: datasets.createdAt,
    updatedAt: datasets.updatedAt,
    archivedAt: datasets.archivedAt,
    deletedAt: datasets.deletedAt,
  };

  async findProjectAccess(
    _actorUserId: string,
    projectId: string,
    _isSuperAdmin: boolean,
  ): Promise<DatasetProjectAccessRow | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findDatasetByProjectAndName(projectId: string, name: string): Promise<DatasetRow | null> {
    const rows = await this.db
      .select(this.datasetSelectFields)
      .from(datasets)
      .where(and(eq(datasets.projectId, projectId), eq(datasets.name, name), isNull(datasets.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  async listDatasets(projectId: string): Promise<DatasetRow[]> {
    return this.db
      .select(this.datasetSelectFields)
      .from(datasets)
      .where(and(eq(datasets.projectId, projectId), isNull(datasets.deletedAt)))
      .orderBy(desc(datasets.createdAt));
  }

  async findDatasetById(projectId: string, datasetId: string): Promise<DatasetRow | null> {
    const rows = await this.db
      .select(this.datasetSelectFields)
      .from(datasets)
      .where(and(eq(datasets.projectId, projectId), eq(datasets.id, datasetId), isNull(datasets.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  async archiveDataset(projectId: string, datasetId: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(datasets)
      .set({ status: 'archived', archivedAt: now, updatedAt: now })
      .where(and(eq(datasets.projectId, projectId), eq(datasets.id, datasetId), isNull(datasets.deletedAt)));
  }

  async restoreDataset(projectId: string, datasetId: string): Promise<void> {
    await this.db
      .update(datasets)
      .set({ status: 'active', archivedAt: null, updatedAt: new Date() })
      .where(and(eq(datasets.projectId, projectId), eq(datasets.id, datasetId), isNull(datasets.deletedAt)));
  }

  // Full scan — only for export (complete dump). Detail browsing must use listDatasetSamplesPage.
  async listDatasetSamples(datasetId: string): Promise<DatasetSampleRow[]> {
    return this.db
      .select()
      .from(datasetSamples)
      .where(eq(datasetSamples.datasetId, datasetId))
      .orderBy(asc(datasetSamples.createdAt), asc(datasetSamples.id));
  }

  // Server-side paginated browse with optional cross-field search (data::text ILIKE), so the detail page
  // never loads an entire (potentially 100k+ sample) dataset into memory.
  async listDatasetSamplesPage(
    datasetId: string,
    options: { limit: number; offset: number; search?: string },
  ): Promise<{ rows: DatasetSampleRow[]; total: number }> {
    const searchTerm = options.search?.trim();
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
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(datasetSamples)
        .where(where),
    ]);

    return { rows, total: Number(countResult[0]?.count ?? 0) };
  }

  // SQL GROUP BY on the expected-output field so list/detail never load all sample rows into memory.
  // Mirrors DatasetService.toCategoryLabel: only scalar (string/number/boolean), non-blank, trimmed labels count.
  async aggregateCategoryDistribution(
    datasetId: string,
    fieldName: string,
  ): Promise<Array<{ label: string; count: number }>> {
    const label = sql<string>`btrim(${datasetSamples.data} ->> ${fieldName})`;
    const rows = await this.db
      .select({ label, count: sql<number>`count(*)::int` })
      .from(datasetSamples)
      .where(
        and(
          eq(datasetSamples.datasetId, datasetId),
          sql`jsonb_typeof(${datasetSamples.data} -> ${fieldName}) IN ('string', 'number', 'boolean')`,
          sql`btrim(${datasetSamples.data} ->> ${fieldName}) <> ''`,
        ),
      )
      // GROUP BY ordinal: the same ${fieldName} binds to different param positions in select vs group-by,
      // so Postgres won't match the expressions textually. Referencing select column 1 sidesteps that.
      .groupBy(sql`1`);
    return rows.map((row) => ({ label: String(row.label), count: Number(row.count) }));
  }

  async hardDeleteDataset(projectId: string, datasetId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        WITH target_optimizations AS (
          SELECT id
          FROM ph_runs.optimizations
          WHERE project_id = ${projectId}::uuid
            AND dataset_id = ${datasetId}::uuid
            AND deleted_at IS NULL
        ),
        target_experiments AS (
          SELECT DISTINCT e.id
          FROM ph_runs.experiments e
          WHERE e.project_id = ${projectId}::uuid
            AND e.deleted_at IS NULL
            AND (
              e.dataset_id = ${datasetId}::uuid
              OR e.optimization_id IN (SELECT id FROM target_optimizations)
            )
        ),
        target_run_results AS (
          SELECT rr.id, rr.created_at
          FROM ph_runs.run_results rr
          WHERE (
            rr.source = 'experiment'
            AND rr.source_id IN (SELECT id FROM target_experiments)
          )
          OR (
            rr.source IN ('optimization_analysis', 'optimization_generate')
            AND rr.source_id IN (SELECT id FROM target_optimizations)
          )
        )
        DELETE FROM ph_runs.annotations annotation
        USING target_run_results rr
        WHERE annotation.run_result_id = rr.id
          AND annotation.run_result_created_at = rr.created_at
      `);

      await tx.execute(sql`
        WITH target_optimizations AS (
          SELECT id
          FROM ph_runs.optimizations
          WHERE project_id = ${projectId}::uuid
            AND dataset_id = ${datasetId}::uuid
            AND deleted_at IS NULL
        ),
        target_experiments AS (
          SELECT DISTINCT e.id
          FROM ph_runs.experiments e
          WHERE e.project_id = ${projectId}::uuid
            AND e.deleted_at IS NULL
            AND (
              e.dataset_id = ${datasetId}::uuid
              OR e.optimization_id IN (SELECT id FROM target_optimizations)
            )
        ),
        target_run_results AS (
          SELECT rr.id, rr.created_at
          FROM ph_runs.run_results rr
          WHERE (
            rr.source = 'experiment'
            AND rr.source_id IN (SELECT id FROM target_experiments)
          )
          OR (
            rr.source IN ('optimization_analysis', 'optimization_generate')
            AND rr.source_id IN (SELECT id FROM target_optimizations)
          )
        )
        DELETE FROM ph_runs.run_results rr
        USING target_run_results target
        WHERE rr.id = target.id
          AND rr.created_at = target.created_at
      `);

      await tx.execute(sql`
        WITH target_optimizations AS (
          SELECT id
          FROM ph_runs.optimizations
          WHERE project_id = ${projectId}::uuid
            AND dataset_id = ${datasetId}::uuid
            AND deleted_at IS NULL
        ),
        target_experiments AS (
          SELECT DISTINCT e.id
          FROM ph_runs.experiments e
          WHERE e.project_id = ${projectId}::uuid
            AND e.deleted_at IS NULL
            AND (
              e.dataset_id = ${datasetId}::uuid
              OR e.optimization_id IN (SELECT id FROM target_optimizations)
            )
        )
        UPDATE ph_releases.release_line_events event
        SET source_experiment_id = NULL,
            updated_at = now()
        WHERE event.project_id = ${projectId}::uuid
          AND event.source_experiment_id IN (SELECT id FROM target_experiments)
      `);

      await tx.execute(sql`
        WITH target_optimizations AS (
          SELECT id
          FROM ph_runs.optimizations
          WHERE project_id = ${projectId}::uuid
            AND dataset_id = ${datasetId}::uuid
            AND deleted_at IS NULL
        ),
        target_experiments AS (
          SELECT DISTINCT e.id
          FROM ph_runs.experiments e
          WHERE e.project_id = ${projectId}::uuid
            AND e.deleted_at IS NULL
            AND (
              e.dataset_id = ${datasetId}::uuid
              OR e.optimization_id IN (SELECT id FROM target_optimizations)
            )
        )
        UPDATE ph_releases.production_release_events event
        SET source_experiment_id = NULL,
            updated_at = now()
        WHERE event.project_id = ${projectId}::uuid
          AND event.source_experiment_id IN (SELECT id FROM target_experiments)
      `);

      await tx.execute(sql`
        WITH target_optimizations AS (
          SELECT id
          FROM ph_runs.optimizations
          WHERE project_id = ${projectId}::uuid
            AND dataset_id = ${datasetId}::uuid
            AND deleted_at IS NULL
        ),
        target_experiments AS (
          SELECT DISTINCT e.id
          FROM ph_runs.experiments e
          WHERE e.project_id = ${projectId}::uuid
            AND e.deleted_at IS NULL
            AND (
              e.dataset_id = ${datasetId}::uuid
              OR e.optimization_id IN (SELECT id FROM target_optimizations)
            )
        )
        UPDATE ph_runs.optimizations optimization
        SET source_experiment_id = NULL,
            updated_at = now()
        WHERE optimization.project_id = ${projectId}::uuid
          AND optimization.source_experiment_id IN (SELECT id FROM target_experiments)
      `);

      await tx.execute(sql`
        WITH target_optimizations AS (
          SELECT id
          FROM ph_runs.optimizations
          WHERE project_id = ${projectId}::uuid
            AND dataset_id = ${datasetId}::uuid
            AND deleted_at IS NULL
        ),
        target_experiments AS (
          SELECT DISTINCT e.id
          FROM ph_runs.experiments e
          WHERE e.project_id = ${projectId}::uuid
            AND e.deleted_at IS NULL
            AND (
              e.dataset_id = ${datasetId}::uuid
              OR e.optimization_id IN (SELECT id FROM target_optimizations)
            )
        )
        DELETE FROM ph_runs.experiments experiment
        USING target_experiments target
        WHERE experiment.id = target.id
      `);

      await tx.execute(sql`
        WITH target_optimizations AS (
          SELECT id
          FROM ph_runs.optimizations
          WHERE project_id = ${projectId}::uuid
            AND dataset_id = ${datasetId}::uuid
            AND deleted_at IS NULL
        )
        DELETE FROM ph_runs.optimization_round_steps step
        USING target_optimizations target
        WHERE step.optimization_id = target.id
      `);

      await tx.execute(sql`
        WITH target_optimizations AS (
          SELECT id
          FROM ph_runs.optimizations
          WHERE project_id = ${projectId}::uuid
            AND dataset_id = ${datasetId}::uuid
            AND deleted_at IS NULL
        )
        DELETE FROM ph_runs.optimizations optimization
        USING target_optimizations target
        WHERE optimization.id = target.id
      `);

      await tx.execute(sql`
        UPDATE ph_assets.prompts
        SET default_dataset_id = NULL,
            updated_at = now()
        WHERE project_id = ${projectId}::uuid
          AND default_dataset_id = ${datasetId}::uuid
      `);

      const deleted = await tx
        .delete(datasets)
        .where(and(eq(datasets.projectId, projectId), eq(datasets.id, datasetId), isNull(datasets.deletedAt)))
        .returning({ id: datasets.id });

      return deleted.length;
    });
  }

  async listDeletionImpact(projectId: string, datasetId: string): Promise<DatasetDeletionImpactRows> {
    const experimentRows = await this.db
      .select({
        id: experiments.id,
        name: experiments.name,
        status: experiments.status,
        datasetId: experiments.datasetId,
        promptId: promptVersions.promptId,
        promptVersionId: experiments.promptVersionId,
        promptVersionNumber: promptVersions.versionNumber,
        createdAt: experiments.createdAt,
      })
      .from(experiments)
      .leftJoin(promptVersions, eq(promptVersions.id, experiments.promptVersionId))
      .where(
        and(eq(experiments.projectId, projectId), eq(experiments.datasetId, datasetId), isNull(experiments.deletedAt)),
      );

    const optimizationRows = await this.db
      .select({
        id: optimizations.id,
        name: optimizations.name,
        status: optimizations.status,
        datasetId: optimizations.datasetId,
        promptId: optimizations.promptId,
        promptVersionId: sql<string | null>`COALESCE(${optimizations.baseVersionId}, ${optimizations.bestVersionId})`,
        promptVersionNumber: sql<number | null>`NULL`,
        createdAt: optimizations.createdAt,
      })
      .from(optimizations)
      .where(
        and(
          eq(optimizations.projectId, projectId),
          eq(optimizations.datasetId, datasetId),
          isNull(optimizations.deletedAt),
        ),
      );

    return {
      experiments: experimentRows,
      optimizations: optimizationRows,
    };
  }

  async updateDatasetMetadata(
    projectId: string,
    datasetId: string,
    args: UpdateDatasetMetadataArgs,
  ): Promise<DatasetRow | null> {
    await this.db
      .update(datasets)
      .set({
        name: args.name,
        description: args.description,
        updatedAt: new Date(),
      })
      .where(and(eq(datasets.projectId, projectId), eq(datasets.id, datasetId), isNull(datasets.deletedAt)));

    return this.findDatasetById(projectId, datasetId);
  }

  async countDatasetReferences(
    datasetIds: string[],
  ): Promise<Map<string, { experiments: number; optimizations: number }>> {
    const result = new Map<string, { experiments: number; optimizations: number }>();
    if (datasetIds.length === 0) return result;

    for (const id of datasetIds) {
      result.set(id, { experiments: 0, optimizations: 0 });
    }

    const experimentRows = await this.db
      .select({
        datasetId: experiments.datasetId,
        count: sql<number>`count(*)::int`,
      })
      .from(experiments)
      .where(and(inArray(experiments.datasetId, datasetIds), isNull(experiments.deletedAt)))
      .groupBy(experiments.datasetId);

    for (const row of experimentRows) {
      const entry = result.get(row.datasetId);
      if (entry) entry.experiments = Number(row.count);
    }

    const iterationRows = await this.db
      .select({
        datasetId: optimizations.datasetId,
        count: sql<number>`count(*)::int`,
      })
      .from(optimizations)
      .where(and(inArray(optimizations.datasetId, datasetIds), isNull(optimizations.deletedAt)))
      .groupBy(optimizations.datasetId);

    for (const row of iterationRows) {
      const entry = result.get(row.datasetId);
      if (entry) entry.optimizations = Number(row.count);
    }

    return result;
  }

  async hardDeleteSamples(datasetId: string, sampleIds: string[]): Promise<number> {
    if (sampleIds.length === 0) return 0;

    const deleted = await this.db
      .delete(datasetSamples)
      .where(and(eq(datasetSamples.datasetId, datasetId), inArray(datasetSamples.id, sampleIds)))
      .returning({ id: datasetSamples.id });

    return deleted.length;
  }

  async decrementDatasetSampleCount(datasetId: string, delta: number): Promise<void> {
    if (delta <= 0) return;
    await this.db
      .update(datasets)
      .set({
        sampleCount: sql`GREATEST(${datasets.sampleCount} - ${delta}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(datasets.id, datasetId));
  }

  async createDatasetWithSamples(args: CreateDatasetRecordArgs): Promise<DatasetRow> {
    return this.db.transaction(async (tx) => {
      const [dataset] = await tx
        .insert(datasets)
        .values({
          id: args.datasetId,
          projectId: args.projectId,
          name: args.dto.name,
          description: args.dto.description?.trim() || null,
          sampleCount: args.dto.samples.length,
          fieldSchema: args.fieldSchema,
          hasImages: args.hasImages,
          storagePrefix: args.storagePrefix,
          createdBy: args.actorUserId,
        })
        .returning();

      if (!dataset) {
        throw new Error('Dataset insert returned no row');
      }

      await tx.insert(datasetSamples).values(
        args.dto.samples.map((sample) => ({
          datasetId: dataset.id,
          data: sample,
          externalId: this.getExternalId(sample, args.externalIdFieldName),
        })),
      );

      return {
        ...dataset,
        createdByDisplayName: null,
      };
    });
  }

  private getExternalId(sample: Record<string, unknown>, externalIdFieldName: string | null) {
    if (!externalIdFieldName) return null;
    const value = sample[externalIdFieldName];
    if (value === undefined || value === null) return null;
    return String(value);
  }
}
