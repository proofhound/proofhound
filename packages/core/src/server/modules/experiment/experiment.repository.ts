import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

const {
  datasets,
  experiments,
  models,
  optimizations,
  productionReleaseEvents,
  projects,
  prompts,
  promptVersions,
  releaseLineEvents,
} = schema;

export interface ExperimentProjectAccessRow {
  id: string;
}

export interface ExperimentRow {
  id: string;
  projectId: string;
  name: string;
  optimizationId: string | null;
  roundIndex: number | null;
  promptId: string;
  promptVersionId: string;
  promptName: string;
  promptVersionNumber: number;
  promptVariables: unknown;
  promptOutputSchema: unknown;
  datasetId: string;
  datasetName: string;
  datasetSamples: number;
  datasetHasImages: boolean;
  datasetFieldSchema: unknown;
  modelId: string;
  modelName: string;
  providerModelId: string;
  status: string;
  controlState: string | null;
  totalSamples: number;
  processedSamples: number;
  failedSamples: number;
  metrics: unknown;
  runConfig: unknown;
  dbosWorkflowId: string | null;
  failureKind: string | null;
  failureReason: string | null;
  createdBy: string;
  createdByDisplayName: string | null;
  createdByUsername: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ExperimentUpdateValues {
  status?: string;
  controlState?: string | null;
  processedSamples?: number;
  failedSamples?: number;
  metrics?: unknown | null;
  failureKind?: string | null;
  failureReason?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export interface ExperimentHardDeleteResult {
  deleted: number;
}

@Injectable()
export class ExperimentRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  private readonly experimentSelectFields = {
    id: experiments.id,
    projectId: experiments.projectId,
    name: experiments.name,
    optimizationId: experiments.optimizationId,
    roundIndex: experiments.roundIndex,
    promptId: prompts.id,
    promptVersionId: experiments.promptVersionId,
    promptName: prompts.name,
    promptVersionNumber: promptVersions.versionNumber,
    promptVariables: promptVersions.variables,
    promptOutputSchema: promptVersions.outputSchema,
    datasetId: experiments.datasetId,
    datasetName: datasets.name,
    datasetSamples: datasets.sampleCount,
    datasetHasImages: datasets.hasImages,
    datasetFieldSchema: datasets.fieldSchema,
    modelId: experiments.modelId,
    modelName: models.name,
    providerModelId: models.providerModelId,
    status: experiments.status,
    controlState: experiments.controlState,
    totalSamples: experiments.totalSamples,
    processedSamples: experiments.processedSamples,
    failedSamples: experiments.failedSamples,
    metrics: experiments.metrics,
    runConfig: experiments.runConfig,
    dbosWorkflowId: experiments.dbosWorkflowId,
    failureKind: experiments.failureKind,
    failureReason: experiments.failureReason,
    createdBy: experiments.createdBy,
    createdByDisplayName: sql<string | null>`NULL`,
    createdByUsername: sql<string | null>`NULL`,
    startedAt: experiments.startedAt,
    finishedAt: experiments.finishedAt,
    createdAt: experiments.createdAt,
    updatedAt: experiments.updatedAt,
    deletedAt: experiments.deletedAt,
  };

  async findProjectAccess(
    _actorUserId: string,
    projectId: string,
    _isSuperAdmin: boolean,
  ): Promise<ExperimentProjectAccessRow | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listExperiments(projectId: string): Promise<ExperimentRow[]> {
    return this.db
      .select(this.experimentSelectFields)
      .from(experiments)
      .innerJoin(promptVersions, eq(promptVersions.id, experiments.promptVersionId))
      .innerJoin(prompts, eq(prompts.id, promptVersions.promptId))
      .innerJoin(datasets, eq(datasets.id, experiments.datasetId))
      .innerJoin(models, eq(models.id, experiments.modelId))
      .where(and(eq(experiments.projectId, projectId), isNull(experiments.deletedAt)))
      .orderBy(desc(experiments.updatedAt), desc(experiments.createdAt));
  }

  async findExperimentById(projectId: string, experimentId: string): Promise<ExperimentRow | null> {
    const rows = await this.db
      .select(this.experimentSelectFields)
      .from(experiments)
      .innerJoin(promptVersions, eq(promptVersions.id, experiments.promptVersionId))
      .innerJoin(prompts, eq(prompts.id, promptVersions.promptId))
      .innerJoin(datasets, eq(datasets.id, experiments.datasetId))
      .innerJoin(models, eq(models.id, experiments.modelId))
      .where(and(eq(experiments.projectId, projectId), eq(experiments.id, experimentId), isNull(experiments.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  async findExperimentByProjectAndName(projectId: string, name: string): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: experiments.id })
      .from(experiments)
      .where(and(eq(experiments.projectId, projectId), eq(experiments.name, name), isNull(experiments.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  async updateExperiment(projectId: string, experimentId: string, values: ExperimentUpdateValues): Promise<void> {
    await this.db
      .update(experiments)
      .set({ ...values, updatedAt: values.updatedAt ?? new Date() })
      .where(
        and(eq(experiments.projectId, projectId), eq(experiments.id, experimentId), isNull(experiments.deletedAt)),
      );
  }

  async hasProductionReleaseSourceReference(projectId: string, experimentId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: productionReleaseEvents.id })
      .from(productionReleaseEvents)
      .where(
        and(
          eq(productionReleaseEvents.projectId, projectId),
          eq(productionReleaseEvents.sourceExperimentId, experimentId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async hardDeleteExperiment(projectId: string, experimentId: string): Promise<ExperimentHardDeleteResult> {
    return this.db.transaction(async (tx) => {
      const now = new Date();

      await tx.execute(sql`
        WITH target_run_results AS (
          SELECT id, created_at
          FROM ph_runs.run_results
          WHERE project_id = ${projectId}::uuid
            AND source = 'experiment'
            AND source_id = ${experimentId}::uuid
        )
        DELETE FROM ph_runs.annotations annotation
        USING target_run_results rr
        WHERE annotation.run_result_id = rr.id
          AND annotation.run_result_created_at = rr.created_at
      `);

      await tx.execute(sql`
        WITH target_run_results AS (
          SELECT id, created_at
          FROM ph_runs.run_results
          WHERE project_id = ${projectId}::uuid
            AND source = 'experiment'
            AND source_id = ${experimentId}::uuid
        )
        DELETE FROM ph_runs.run_results rr
        USING target_run_results target
        WHERE rr.id = target.id
          AND rr.created_at = target.created_at
      `);

      await tx
        .update(optimizations)
        .set({ sourceExperimentId: null, updatedAt: now })
        .where(and(eq(optimizations.projectId, projectId), eq(optimizations.sourceExperimentId, experimentId)));

      await tx
        .update(productionReleaseEvents)
        .set({ sourceExperimentId: null, updatedAt: now })
        .where(
          and(
            eq(productionReleaseEvents.projectId, projectId),
            eq(productionReleaseEvents.sourceExperimentId, experimentId),
          ),
        );

      await tx
        .update(releaseLineEvents)
        .set({ sourceExperimentId: null, updatedAt: now })
        .where(and(eq(releaseLineEvents.projectId, projectId), eq(releaseLineEvents.sourceExperimentId, experimentId)));

      const deleted = await tx
        .delete(experiments)
        .where(and(eq(experiments.projectId, projectId), eq(experiments.id, experimentId)))
        .returning({ id: experiments.id });
      return { deleted: deleted.length };
    });
  }

  async createExperiment(args: CreateExperimentRecordArgs): Promise<string> {
    const [row] = await this.db
      .insert(experiments)
      .values({
        projectId: args.projectId,
        name: args.name,
        promptVersionId: args.promptVersionId,
        datasetId: args.datasetId,
        modelId: args.modelId,
        status: 'running',
        startedAt: new Date(),
        runConfig: args.runConfig ?? {},
        totalSamples: args.totalSamples,
        createdBy: args.createdBy,
      })
      .returning({ id: experiments.id });
    if (!row) throw new Error('experiment_insert_failed');
    return row.id;
  }

  async setDbosWorkflowId(experimentId: string, dbosWorkflowId: string): Promise<void> {
    await this.db
      .update(experiments)
      .set({ dbosWorkflowId, updatedAt: new Date() })
      .where(eq(experiments.id, experimentId));
  }

  async findActiveRunningWithWorkflow(): Promise<
    Array<{ experimentId: string; projectId: string; dbosWorkflowId: string }>
  > {
    const rows = await this.db
      .select({ id: experiments.id, projectId: experiments.projectId, dbosWorkflowId: experiments.dbosWorkflowId })
      .from(experiments)
      .where(and(eq(experiments.status, 'running'), isNull(experiments.deletedAt)));
    return rows
      .filter(
        (r): r is { id: string; projectId: string; dbosWorkflowId: string } =>
          typeof r.dbosWorkflowId === 'string' && r.dbosWorkflowId.length > 0,
      )
      .map((r) => ({ experimentId: r.id, projectId: r.projectId, dbosWorkflowId: r.dbosWorkflowId }));
  }
}

export interface CreateExperimentRecordArgs {
  projectId: string;
  name: string;
  promptVersionId: string;
  datasetId: string;
  modelId: string;
  runConfig?: Record<string, unknown>;
  totalSamples: number;
  createdBy: string;
}
