import { BadRequestException, Injectable } from '@nestjs/common';
import {
  QUICK_START_DEFAULT_CONCURRENCY,
  QUICK_START_DEFAULT_RPM_LIMIT,
  QUICK_START_DEFAULT_SAMPLE_TIMEOUT_SECONDS,
  QUICK_START_DEFAULT_TEMPERATURE,
  QUICK_START_DEFAULT_TPM_LIMIT,
} from '@proofhound/shared';
import type {
  CreateOptimizationDto,
  CreateQuickStartDto,
  DatasetFieldMappingDto,
  ProbeQuickStartDraftModelDto,
  ProjectContext,
  QuickStartCreateResponseDto,
  QuickStartDatasetDto,
  QuickStartModelRefDto,
} from '@proofhound/shared';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { OptimizationService } from '../optimization/optimization.service';
import { DatasetService } from '../dataset/dataset.service';
import { ModelService } from '../model/model.service';

type AuditSource = 'api' | 'mcp';

interface ResolvedModelCache {
  [cacheKey: string]: ResolvedQuickStartModel;
}

interface ResolvedQuickStartModel {
  id: string;
  rpmLimit: number;
  tpmLimit: number;
  concurrency: number;
}

@Injectable()
export class QuickStartService {
  constructor(
    private readonly datasets: DatasetService,
    private readonly models: ModelService,
    private readonly optimizations: OptimizationService,
  ) {}

  async listModelOptions(actor: CurrentUserPayload) {
    return this.models.listQuickStartModelOptions(actor);
  }

  async probeDraftModel(dto: ProbeQuickStartDraftModelDto, actor: CurrentUserPayload, source: AuditSource = 'api') {
    return this.models.probeQuickStartDraftModel(dto, actor, source);
  }

  async probeExistingModel(modelId: string, actor: CurrentUserPayload, source: AuditSource = 'api') {
    return this.models.probeQuickStartExistingModel(modelId, actor, source);
  }

  async createQuickStart(
    dto: CreateQuickStartDto,
    project: ProjectContext,
    actor: CurrentUserPayload,
    source: AuditSource = 'api',
  ): Promise<QuickStartCreateResponseDto> {
    const stem = getFileStem(dto.dataset.uploadSource.fileName);
    const englishPromptLanguage = dto.promptLanguage === 'en-US';
    const projectId = project.projectId;

    const datasetId = await this.resolveDataset(projectId, dto.dataset, actor);

    const modelCache: ResolvedModelCache = {};
    const experimentModel = await this.resolveModel(project, dto.experimentModel, actor, source, modelCache);
    const analysisModel = await this.resolveModel(project, dto.analysisModel, actor, source, modelCache);

    const optimizationBody: CreateOptimizationDto = {
      name: dto.optimizationName ?? (englishPromptLanguage ? `${stem} Optimization #1` : `${stem} 优化 #1`),
      description: dto.taskDescription,
      optimizationHint: dto.taskDescription,
      strategy: 'error_pattern_analysis',
      strategyConfig: dto.strategyConfig,
      startingMode: 'from_dataset_only',
      datasetId,
      experimentModelId: experimentModel.id,
      analysisModelId: analysisModel.id,
      promptLanguage: dto.promptLanguage,
      goals: dto.goals,
      fieldWhitelist: buildFieldWhitelist(dto.dataset.fieldMappings),
      runConfig: {
        temperature: QUICK_START_DEFAULT_TEMPERATURE,
        rpmLimit: experimentModel.rpmLimit,
        tpmLimit: experimentModel.tpmLimit,
        concurrency: experimentModel.concurrency,
        sampleTimeoutSeconds: QUICK_START_DEFAULT_SAMPLE_TIMEOUT_SECONDS,
        ...dto.runConfig,
      },
      loopLimits: dto.loopLimits,
    };
    const optimization = await this.optimizations.createOptimization(
      projectId,
      optimizationBody,
      actor,
      source,
      project.orgId,
    );

    return {
      projectId,
      datasetId,
      promptId: optimization.promptId,
      optimizationId: optimization.id,
    };
  }

  private async resolveDataset(projectId: string, dataset: QuickStartDatasetDto, actor: CurrentUserPayload) {
    if (isImportedDataset(dataset)) {
      const existing = await this.datasets.getDataset(projectId, dataset.datasetId, actor);
      if (existing.status !== 'active') {
        throw new BadRequestException('quick_start_dataset_not_active');
      }
      assertImportedDatasetMappingsExist(dataset.fieldMappings, existing.fieldSchema);
      return existing.id;
    }

    const created = await this.datasets.createDataset(projectId, dataset, actor);
    return created.dataset.id;
  }

  private async resolveModel(
    project: ProjectContext,
    ref: QuickStartModelRefDto,
    actor: CurrentUserPayload,
    source: AuditSource,
    cache: ResolvedModelCache,
  ): Promise<ResolvedQuickStartModel> {
    const cacheKey = getModelRefCacheKey(ref);
    if (cache[cacheKey]) return cache[cacheKey];

    if (ref.kind === 'existing') {
      const model = await this.models.getQuickStartModelOption(ref.modelId, actor);
      const resolved = {
        id: model.id,
        rpmLimit: toRunConfigLimit(model.rpm.limit, QUICK_START_DEFAULT_RPM_LIMIT),
        tpmLimit: toRunConfigLimit(model.tpm.limit, QUICK_START_DEFAULT_TPM_LIMIT),
        concurrency: toRunConfigLimit(model.concurrency.limit, QUICK_START_DEFAULT_CONCURRENCY),
      };
      cache[cacheKey] = resolved;
      return resolved;
    }

    const created = await this.models.createProjectModel(project.projectId, ref.model, actor, source, project.orgId);
    const resolved = {
      id: created.id,
      rpmLimit: toRunConfigLimit(ref.model.rpm.limit, QUICK_START_DEFAULT_RPM_LIMIT),
      tpmLimit: toRunConfigLimit(ref.model.tpm.limit, QUICK_START_DEFAULT_TPM_LIMIT),
      concurrency: toRunConfigLimit(ref.model.concurrency.limit, QUICK_START_DEFAULT_CONCURRENCY),
    };
    cache[cacheKey] = resolved;
    return resolved;
  }
}

function toRunConfigLimit(limit: number, fallback: number): number {
  return limit > 0 ? limit : fallback;
}

function getFileStem(fileName: string): string {
  const leaf = fileName.split('/').pop() ?? fileName;
  const stem = leaf.replace(/\.[^.]+$/u, '').trim();
  return stem.length > 0 ? stem.slice(0, 80) : 'dataset';
}

function getModelRefCacheKey(ref: QuickStartModelRefDto): string {
  if (ref.kind === 'existing') return `existing:${ref.modelId}`;
  return `draft:${JSON.stringify(ref.model)}`;
}

function buildFieldWhitelist(fieldMappings: CreateQuickStartDto['dataset']['fieldMappings']) {
  const inputFields = fieldMappings
    .filter((field) => field.role === 'text' || field.role === 'image')
    .map((field) => field.name);
  const metaFields = fieldMappings
    .filter((field) => field.role === 'id' || field.role === 'metadata')
    .map((field) => field.name);

  if (inputFields.length === 0) {
    throw new BadRequestException('quick_start_input_field_required');
  }

  return { inputFields, metaFields };
}

function isImportedDataset(dataset: QuickStartDatasetDto): dataset is Extract<QuickStartDatasetDto, { kind: 'imported' }> {
  return 'kind' in dataset && dataset.kind === 'imported';
}

function assertImportedDatasetMappingsExist(
  fieldMappings: DatasetFieldMappingDto[],
  fieldSchema: Array<{ name: string }>,
) {
  const available = new Set(fieldSchema.map((field) => field.name));
  const missing = fieldMappings.find((field) => !available.has(field.name));
  if (missing) {
    throw new BadRequestException('quick_start_dataset_field_missing');
  }
}
