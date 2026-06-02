import { Buffer } from 'node:buffer';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  createExperimentSchema,
  datasetFieldSchema,
  deriveDatasetModalities,
  experimentControlActionSchema,
  experimentMetricsSchema,
  experimentRunConfigSchema,
  promptOutputSchema,
  promptVariableSchema,
  type CreateExperimentDto,
  type ExperimentControlActionDto,
  type ExperimentExportFormatDto,
  type ExperimentListItemDto,
  type ExperimentListQueryDto,
  type ExperimentListResponseDto,
  type ExperimentListStatsDto,
  type ExperimentMetricsDto,
  type ExperimentRunConfigDto,
  type ExperimentStatusDto,
  type PromptVariableTypeDto,
} from '@proofhound/shared';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { WorkflowAuthorizationHook } from '../../common/contracts/workflow-authorization.hook';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { isUniqueViolation } from '../../common/errors/db-error';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';
import { ModelService } from '../model/model.service';
import { RunResultService } from '../run-result/run-result.service';
import { aggregateExperimentMetrics } from './experiment.aggregator';
import { ExperimentLauncher } from './experiment.launcher';
import { ExperimentRepository, type ExperimentProjectAccessRow, type ExperimentRow } from './experiment.repository';

const { datasets, promptVersions, prompts } = schema;

const MONTHLY_COST_QUOTA = 200;

export interface ExperimentExportFile {
  fileName: string;
  contentType: string;
  byteLength: number;
  buffer: Buffer;
  format: ExperimentExportFormatDto;
}

type AuditSource = 'api' | 'mcp' | 'system';

@Injectable()
export class ExperimentService {
  constructor(
    private readonly repo: ExperimentRepository,
    private readonly launcher: ExperimentLauncher,
    private readonly modelService: ModelService,
    private readonly runResults: RunResultService,
    @Inject(DATABASE_CLIENT) private readonly db: DbClient,
    private readonly accessControl: AccessControlService,
    private readonly workflowAuth: WorkflowAuthorizationHook,
  ) {}

  async createExperiment(
    projectId: string,
    dto: CreateExperimentDto,
    actor: CurrentUserPayload,
    source: AuditSource = 'api',
  ): Promise<ExperimentListItemDto> {
    await this.getWritableProject(projectId, actor);
    const parsed = createExperimentSchema.parse(dto);
    const existing = await this.repo.findExperimentByProjectAndName(projectId, parsed.name);
    if (existing) {
      throw new ConflictException('experiment_name_taken');
    }
    const context = await this.loadAndValidateReferences(projectId, parsed);

    await this.workflowAuth.assertCanStart(toActorContext(actor), { projectId, source: 'local' }, 'experiment');

    if (!context.promptVersion.isFrozen) {
      await this.freezePromptVersion(parsed.promptVersionId);
    }

    const experimentId = await this.createExperimentOrThrowNameConflict({
      projectId,
      name: parsed.name,
      promptVersionId: parsed.promptVersionId,
      datasetId: parsed.datasetId,
      modelId: parsed.modelId,
      runConfig: parsed.runConfig ?? {},
      totalSamples: context.dataset.sampleCount,
      createdBy: actor.sub,
    });

    let workflowId: string | null = null;
    try {
      workflowId = await this.launcher.launch(experimentId);
    } catch (error) {
      await this.repo.updateExperiment(projectId, experimentId, {
        status: 'failed',
        controlState: null,
        finishedAt: new Date(),
        failureKind: 'internal',
        failureReason: (error as Error).message,
      });
      throw error;
    }

    const row = await this.repo.findExperimentById(projectId, experimentId);
    if (!row) throw new NotFoundException(`Experiment ${experimentId} not found after create`);
    return this.withLiveMetrics(this.toExperimentListItem(row));
  }

  async listExperiments(
    projectId: string,
    actor: CurrentUserPayload,
    query: ExperimentListQueryDto = {},
  ): Promise<ExperimentListResponseDto> {
    await this.getAccessibleProject(projectId, actor);

    const allRows = await this.repo.listExperiments(projectId);
    const baseItems = allRows.map((row) => this.toExperimentListItem(row));
    const allItems = await Promise.all(baseItems.map((item) => this.withLiveMetrics(item)));
    const filtered = this.filterExperiments(allItems, query);
    const data = this.sortExperiments(filtered, query.sort);

    return {
      data,
      total: data.length,
      stats: this.buildStats(allItems),
    };
  }

  async getExperiment(
    projectId: string,
    experimentId: string,
    actor: CurrentUserPayload,
  ): Promise<ExperimentListItemDto> {
    await this.getAccessibleProject(projectId, actor);

    const row = await this.repo.findExperimentById(projectId, experimentId);
    if (!row) {
      throw new NotFoundException(`Experiment ${experimentId} not found`);
    }

    return this.withLiveMetrics(this.toExperimentListItem(row));
  }

  async controlExperiment(
    projectId: string,
    experimentId: string,
    action: ExperimentControlActionDto,
    actor: CurrentUserPayload,
    source: AuditSource = 'api',
  ): Promise<ExperimentListItemDto> {
    await this.getWritableProject(projectId, actor);
    const parsedAction = experimentControlActionSchema.parse(action);
    const current = await this.repo.findExperimentById(projectId, experimentId);
    if (!current) {
      throw new NotFoundException(`Experiment ${experimentId} not found`);
    }

    const nextValues = this.getControlPatch(parsedAction, current);
    await this.repo.updateExperiment(projectId, experimentId, nextValues);

    if (parsedAction === 'resume' || parsedAction === 'retry') {
      await this.workflowAuth.assertCanStart(toActorContext(actor), { projectId, source: 'local' }, 'experiment');
      try {
        if (parsedAction === 'resume') await this.launcher.resume(experimentId);
        else await this.launcher.retry(experimentId);
      } catch (error) {
        // When the launcher throws, set status to failed directly (SPEC 24 §5)
        await this.repo.updateExperiment(projectId, experimentId, {
          status: 'failed',
          controlState: null,
          finishedAt: new Date(),
          failureKind: 'internal',
          failureReason: (error as Error).message,
        });
        throw error;
      }
    }

    const updated = await this.repo.findExperimentById(projectId, experimentId);
    if (!updated) {
      throw new NotFoundException(`Experiment ${experimentId} not found after update`);
    }

    return this.withLiveMetrics(this.toExperimentListItem(updated));
  }

  async deleteExperiment(
    projectId: string,
    experimentId: string,
    actor: CurrentUserPayload,
    source: AuditSource = 'api',
  ): Promise<void> {
    void source;
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findExperimentById(projectId, experimentId);
    if (!row) {
      throw new NotFoundException(`Experiment ${experimentId} not found`);
    }

    if (await this.repo.hasProductionReleaseSourceReference(projectId, experimentId)) {
      throw new ConflictException('experiment_delete_referenced_by_production_release');
    }

    await this.repo.hardDeleteExperiment(projectId, experimentId);
  }

  async exportExperiments(
    projectId: string,
    format: ExperimentExportFormatDto,
    actor: CurrentUserPayload,
    experimentId?: string,
  ): Promise<ExperimentExportFile> {
    const items = experimentId
      ? [await this.getExperiment(projectId, experimentId, actor)]
      : (await this.listExperiments(projectId, actor)).data;
    const content = format === 'csv' ? this.toCsv(items) : this.toJsonl(items);
    const buffer = Buffer.from(content, 'utf8');

    return {
      buffer,
      byteLength: buffer.byteLength,
      contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      fileName: this.getExportFileName(projectId, format, experimentId ? items[0]?.name : undefined),
      format,
    };
  }

  private async getAccessibleProject(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<ExperimentProjectAccessRow> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const project = await this.repo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }

  private async getWritableProject(projectId: string, actor: CurrentUserPayload): Promise<ExperimentProjectAccessRow> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    return this.getAccessibleProject(projectId, actor);
  }

  private async createExperimentOrThrowNameConflict(args: {
    projectId: string;
    name: string;
    promptVersionId: string;
    datasetId: string;
    modelId: string;
    runConfig?: Record<string, unknown>;
    totalSamples: number;
    createdBy: string;
  }): Promise<string> {
    try {
      return await this.repo.createExperiment(args);
    } catch (error) {
      if (isExperimentNameUniqueViolation(error)) {
        throw new ConflictException('experiment_name_taken');
      }
      throw error;
    }
  }

  private getControlPatch(action: ExperimentControlActionDto, row: ExperimentRow) {
    const status = row.status as ExperimentStatusDto;
    const now = new Date();

    if (action === 'stop') {
      if (status !== 'running') {
        throw new ConflictException('experiment_stop_invalid_status');
      }
      // Only writes control_state; the actual status is flipped to stopped by the workflow once it observes the change at a step boundary
      return {
        controlState: 'stop',
        updatedAt: now,
      };
    }

    if (action === 'resume') {
      if (status !== 'stopped') {
        throw new ConflictException('experiment_resume_invalid_status');
      }
      return {
        status: 'running',
        controlState: 'resume',
        finishedAt: null,
        updatedAt: now,
      };
    }

    if (action === 'cancel') {
      if (status === 'success' || status === 'cancelled') {
        throw new ConflictException('experiment_cancel_invalid_status');
      }
      // Only writes control_state; once observed, the workflow writes status=cancelled + finished_at
      return {
        controlState: 'cancel',
        updatedAt: now,
      };
    }

    if (status !== 'failed' && status !== 'cancelled' && status !== 'stopped') {
      throw new ConflictException('experiment_retry_invalid_status');
    }

    return {
      status: 'running',
      controlState: null,
      processedSamples: 0,
      failedSamples: 0,
      metrics: null,
      failureKind: null,
      failureReason: null,
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
    };
  }

  private async loadAndValidateReferences(projectId: string, dto: CreateExperimentDto) {
    const rows = await this.db
      .select({
        promptVersionId: promptVersions.id,
        promptId: promptVersions.promptId,
        promptName: prompts.name,
        versionNumber: promptVersions.versionNumber,
        body: promptVersions.body,
        variables: promptVersions.variables,
        outputSchema: promptVersions.outputSchema,
        judgmentRules: promptVersions.judgmentRules,
        isFrozen: promptVersions.isFrozen,
        promptDeletedAt: prompts.deletedAt,
      })
      .from(promptVersions)
      .innerJoin(prompts, eq(prompts.id, promptVersions.promptId))
      .where(and(eq(prompts.projectId, projectId), eq(promptVersions.id, dto.promptVersionId)))
      .limit(1);
    const pv = rows[0];
    if (!pv) throw new BadRequestException('prompt_version_not_found');
    if (pv.promptDeletedAt) throw new BadRequestException('prompt_deleted');

    const dsRows = await this.db
      .select({
        id: datasets.id,
        sampleCount: datasets.sampleCount,
        deletedAt: datasets.deletedAt,
      })
      .from(datasets)
      .where(and(eq(datasets.projectId, projectId), eq(datasets.id, dto.datasetId)))
      .limit(1);
    const ds = dsRows[0];
    if (!ds) throw new BadRequestException('dataset_not_found');
    if (ds.deletedAt) throw new BadRequestException('dataset_deleted');
    if (ds.sampleCount <= 0) throw new BadRequestException('dataset_empty');

    const model = await this.modelService.findModelAccessibleToProject(projectId, dto.modelId);
    if (!model) throw new BadRequestException('model_not_found');
    if (model.deletedAt) throw new BadRequestException('model_deleted');
    if (!model.isActive) throw new BadRequestException('model_inactive');

    return {
      promptVersion: pv,
      dataset: ds,
      model,
    };
  }

  private async freezePromptVersion(promptVersionId: string): Promise<void> {
    await this.db
      .update(promptVersions)
      .set({ isFrozen: true, frozenAt: sql`now()` })
      .where(and(eq(promptVersions.id, promptVersionId), eq(promptVersions.isFrozen, false)));
  }

  private toExperimentListItem(row: ExperimentRow): ExperimentListItemDto {
    const runConfig = this.parseRunConfig(row.runConfig);
    const metrics = this.parseMetrics(row.metrics);
    const promptVariableTypes = this.derivePromptVariableTypes(row.promptVariables);
    const datasetFieldSchemaParse = z.array(datasetFieldSchema).safeParse(row.datasetFieldSchema ?? []);
    const datasetFieldSchemaValue = datasetFieldSchemaParse.success ? datasetFieldSchemaParse.data : [];
    const datasetModalities = deriveDatasetModalities(datasetFieldSchemaValue);
    const outputSchemaParse = promptOutputSchema.safeParse(row.promptOutputSchema ?? null);
    const outputSchemaValue = outputSchemaParse.success ? outputSchemaParse.data : null;

    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: typeof runConfig.description === 'string' ? runConfig.description : null,
      optimizationId: row.optimizationId,
      roundIndex: row.roundIndex,
      promptId: row.promptId,
      promptVersionId: row.promptVersionId,
      promptName: row.promptName,
      promptVersionNumber: row.promptVersionNumber,
      promptVersionLabel: `v${row.promptVersionNumber}`,
      datasetId: row.datasetId,
      datasetName: row.datasetName,
      datasetSamples: row.datasetSamples,
      datasetHasImages: row.datasetHasImages,
      datasetModalities,
      datasetFieldSchema: datasetFieldSchemaValue.length > 0 ? datasetFieldSchemaValue : null,
      outputSchema: outputSchemaValue,
      modelId: row.modelId,
      modelName: row.modelName,
      modelVariant: this.getModelVariant(row.providerModelId, runConfig),
      promptVariableTypes,
      status: row.status as ExperimentStatusDto,
      controlState: row.controlState as ExperimentListItemDto['controlState'],
      totalSamples: row.totalSamples,
      processedSamples: row.processedSamples,
      failedSamples: row.failedSamples,
      metrics,
      runConfig,
      dbosWorkflowId: row.dbosWorkflowId,
      failureReason: row.failureReason,
      failureKind: row.failureKind as ExperimentListItemDto['failureKind'],
      createdBy: row.createdBy,
      createdByDisplayName: row.createdByDisplayName,
      createdByUsername: row.createdByUsername,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  // For running experiments, aggregate from ph_runs.run_results in real time, overriding DTO progress and metric fields (SPEC 24 §4).
  // Terminal experiments return the original item directly, continuing to read the experiments table snapshot to avoid triggering a GROUP BY on every GET.
  private async withLiveMetrics(item: ExperimentListItemDto): Promise<ExperimentListItemDto> {
    if (item.status !== 'running') return item;
    const [rows, latency] = await Promise.all([
      this.runResults.aggregateExperiment(item.id),
      this.runResults.aggregateExperimentLatency(item.id),
    ]);
    const { metrics, totalCount, failedCount } = aggregateExperimentMetrics(rows, latency);
    return {
      ...item,
      processedSamples: totalCount,
      failedSamples: failedCount,
      metrics,
    };
  }

  private parseRunConfig(value: unknown): ExperimentRunConfigDto {
    const parse = experimentRunConfigSchema.safeParse(value ?? {});
    return parse.success ? parse.data : {};
  }

  private derivePromptVariableTypes(value: unknown): PromptVariableTypeDto[] {
    const parse = z.array(promptVariableSchema).safeParse(value ?? []);
    if (!parse.success) return [];
    return Array.from(new Set(parse.data.map((variable) => variable.type)));
  }

  private parseMetrics(value: unknown): ExperimentMetricsDto {
    const parse = experimentMetricsSchema.safeParse(value ?? null);
    return parse.success ? parse.data : null;
  }

  private getModelVariant(providerModelId: string, runConfig: ExperimentRunConfigDto) {
    if (typeof runConfig.temperature === 'number') {
      return `temp ${runConfig.temperature.toFixed(1)}`;
    }
    return providerModelId;
  }

  private filterExperiments(items: ExperimentListItemDto[], query: ExperimentListQueryDto) {
    const search = query.search?.trim().toLowerCase();
    return items.filter((item) => {
      if (query.status && item.status !== query.status) return false;
      if (!search) return true;
      return [
        item.name,
        item.description ?? '',
        item.promptName,
        item.promptVersionLabel,
        item.datasetName,
        item.modelName,
        item.modelVariant,
        item.createdByDisplayName ?? '',
        item.createdByUsername ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
  }

  private sortExperiments(items: ExperimentListItemDto[], sort: ExperimentListQueryDto['sort']) {
    return [...items].sort((a, b) => {
      if (sort === 'accuracy') {
        return (b.metrics?.accuracy ?? -1) - (a.metrics?.accuracy ?? -1);
      }
      if (sort === 'duration') {
        return this.getDurationSeconds(b) - this.getDurationSeconds(a);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  private buildStats(items: ExperimentListItemDto[]): ExperimentListStatsDto {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    const durations = items
      .map((item) => this.getDurationSeconds(item))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);

    const inputTokens = items.reduce((sum, item) => sum + Math.max(0, item.metrics?.inputTokens ?? 0), 0);
    const outputTokens = items.reduce((sum, item) => sum + Math.max(0, item.metrics?.outputTokens ?? 0), 0);
    const costEstimate = items.reduce((sum, item) => sum + Math.max(0, item.metrics?.costEstimate ?? 0), 0);
    const monthlyCostEstimate = items
      .filter((item) => item.createdAt.slice(0, 7) === currentMonth)
      .reduce((sum, item) => sum + Math.max(0, item.metrics?.costEstimate ?? 0), 0);

    return {
      newThisWeek: items.filter((item) => Date.parse(item.createdAt) >= weekAgo).length,
      averageDurationSeconds: durations.length
        ? durations.reduce((sum, value) => sum + value, 0) / durations.length
        : null,
      medianDurationSeconds: this.quantile(durations, 0.5),
      p90DurationSeconds: this.quantile(durations, 0.9),
      inputTokens,
      outputTokens,
      costEstimate,
      monthlyCostEstimate,
      monthlyCostQuota: MONTHLY_COST_QUOTA,
    };
  }

  private getDurationSeconds(item: ExperimentListItemDto) {
    const start = Date.parse(item.startedAt ?? item.createdAt);
    const end = Date.parse(item.finishedAt ?? item.updatedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
    return Math.round((end - start) / 1000);
  }

  private quantile(values: number[], q: number) {
    if (values.length === 0) return null;
    const index = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * q)));
    return values[index] ?? null;
  }

  private toCsv(items: ExperimentListItemDto[]) {
    const columns = [
      'id',
      'name',
      'status',
      'prompt',
      'dataset',
      'model',
      'processed_samples',
      'total_samples',
      'failed_samples',
      'accuracy',
      'precision',
      'recall',
      'f1',
      'started_at',
      'finished_at',
      'updated_at',
    ];
    const rows = items.map((item) =>
      [
        item.id,
        item.name,
        item.status,
        `${item.promptName} ${item.promptVersionLabel}`,
        item.datasetName,
        item.modelName,
        item.processedSamples,
        item.totalSamples,
        item.failedSamples,
        item.metrics?.accuracy ?? '',
        item.metrics?.precision ?? '',
        item.metrics?.recall ?? '',
        item.metrics?.f1 ?? '',
        item.startedAt ?? '',
        item.finishedAt ?? '',
        item.updatedAt,
      ]
        .map((value) => this.toCsvCell(value))
        .join(','),
    );

    return `\uFEFF${[columns.join(','), ...rows].join('\n')}\n`;
  }

  private toJsonl(items: ExperimentListItemDto[]) {
    return `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;
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

  private getExportFileName(projectId: string, format: ExperimentExportFormatDto, experimentName?: string) {
    const baseName = experimentName ? `experiment-${experimentName}` : `experiments-${projectId.slice(0, 8)}`;
    const safeName =
      baseName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/gu, '-')
        .replace(/^-+|-+$/gu, '') || 'experiments';

    return `${safeName}.${format}`;
  }
}

function isExperimentNameUniqueViolation(error: unknown): boolean {
  return isUniqueViolation(error, /idx_experiments_project_name_active/);
}
