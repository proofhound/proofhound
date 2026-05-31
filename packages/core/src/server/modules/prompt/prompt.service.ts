import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PROMPT_LANGUAGE,
  promptVariableSchema,
  promptLanguageSchema,
  type CreatePromptDraftVersionDto,
  type CreatePromptDto,
  type PromptDeletionImpactDto,
  type PromptDeletionImpactItemDto,
  type PromptDetailDto,
  type PromptJudgmentRulesDto,
  type PromptMetricsDto,
  type PromptListItemDto,
  type PromptOutputSchemaDto,
  type PromptVariableDto,
  type PromptVersionDto,
  type PromptVersionLabelDto,
  type PromptVersionStatusDto,
  type UpdatePromptDraftVersionDto,
  type UpdatePromptDto,
  type UpdatePromptVersionLabelDto,
} from '@proofhound/shared';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { isUniqueViolation } from '../../common/errors/db-error';
import {
  PromptRepository,
  type PromptDeletionImpactRow,
  type PromptProjectAccessRow,
  type PromptRow,
  type PromptVersionLabelRow,
  type PromptVersionRow,
} from './prompt.repository';

const MOVABLE_SYSTEM_LABELS = new Set(['gray', 'production']);
const DERIVED_LATEST_LABEL = 'latest';

@Injectable()
export class PromptService {
  constructor(
    private readonly repo: PromptRepository,
    private readonly accessControl: AccessControlService,
  ) {}

  async listPrompts(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<{ data: PromptListItemDto[]; total: number }> {
    await this.getAccessibleProject(projectId, actor);

    const rows = await this.repo.listPrompts(projectId);
    const versions = await this.repo.listVersionsByPromptIds(rows.map((row) => row.id));
    const references = await this.getReferenceCounts(versions);
    const labels = await this.repo.listLabelsByPromptIds(rows.map((row) => row.id));
    const versionsByPromptId = this.groupVersions(versions);
    const labelsByPromptId = this.groupLabels(labels);
    const data = rows.map((row) =>
      this.toPromptListItem(row, versionsByPromptId.get(row.id) ?? [], references, labelsByPromptId.get(row.id) ?? []),
    );
    return { data, total: data.length };
  }

  async getPrompt(projectId: string, promptId: string, actor: CurrentUserPayload): Promise<PromptDetailDto> {
    await this.getAccessibleProject(projectId, actor);

    const row = await this.repo.findPromptById(projectId, promptId);
    if (!row) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const versions = await this.repo.listVersionsByPromptIds([promptId]);
    const references = await this.getReferenceCounts(versions);
    const labels = await this.repo.listLabelsByPromptIds([promptId]);
    return this.toPromptDetail(row, versions, references, labels);
  }

  async createPrompt(projectId: string, dto: CreatePromptDto, actor: CurrentUserPayload): Promise<PromptDetailDto> {
    await this.getWritableProject(projectId, actor);

    const existing = await this.repo.findPromptByProjectAndName(projectId, dto.name);
    if (existing) {
      throw new ConflictException('prompt_name_taken');
    }

    if (dto.defaultDatasetId) {
      const dataset = await this.repo.findDatasetInProject(projectId, dto.defaultDatasetId);
      if (!dataset) {
        throw new BadRequestException('default_dataset_not_found');
      }
    }

    const created = await this.createPromptOrThrowNameConflict(projectId, dto, actor.sub);

    return this.getPrompt(projectId, created.prompt.id, actor);
  }

  async updatePrompt(
    projectId: string,
    promptId: string,
    dto: UpdatePromptDto,
    actor: CurrentUserPayload,
  ): Promise<PromptDetailDto> {
    await this.getWritableProject(projectId, actor);

    const prompt = await this.repo.findPromptById(projectId, promptId);
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const dataset = await this.repo.findDatasetInProject(projectId, dto.defaultDatasetId);
    if (!dataset) {
      throw new BadRequestException('default_dataset_not_found');
    }

    if (prompt.defaultDatasetId !== dto.defaultDatasetId) {
      await this.repo.updatePromptDefaultDataset(projectId, promptId, dto.defaultDatasetId);
    }

    return this.getPrompt(projectId, promptId, actor);
  }

  async updateDraftVersion(
    projectId: string,
    promptId: string,
    versionId: string,
    dto: UpdatePromptDraftVersionDto,
    actor: CurrentUserPayload,
  ): Promise<PromptDetailDto> {
    await this.getWritableProject(projectId, actor);

    const prompt = await this.repo.findPromptById(projectId, promptId);
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const versions = await this.repo.listVersionsByPromptIds([promptId]);
    const version = versions.find((item) => item.id === versionId);
    if (!version) {
      throw new NotFoundException(`Prompt version ${versionId} not found`);
    }
    if (version.isFrozen) {
      throw new ConflictException('prompt_version_frozen');
    }

    await this.repo.updateDraftVersion(projectId, promptId, versionId, dto);

    return this.getPrompt(projectId, promptId, actor);
  }

  async createDraftVersion(
    projectId: string,
    promptId: string,
    dto: CreatePromptDraftVersionDto,
    actor: CurrentUserPayload,
  ): Promise<PromptDetailDto> {
    await this.getWritableProject(projectId, actor);

    const prompt = await this.repo.findPromptById(projectId, promptId);
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    if (dto.sourceVersionId) {
      const sourceVersion = await this.repo.findVersionInPrompt(promptId, dto.sourceVersionId);
      if (!sourceVersion) {
        throw new NotFoundException(`Prompt version ${dto.sourceVersionId} not found`);
      }
      if (sourceVersion.promptId !== promptId) {
        throw new BadRequestException('source_version_prompt_mismatch');
      }

      const fallbackReason = `基于 v${sourceVersion.versionNumber} 复制`;
      const changeReason = dto.changeReason?.trim() ? dto.changeReason.trim() : fallbackReason;

      await this.repo.createDraftVersionFromSource(promptId, dto.sourceVersionId, actor.sub, changeReason);
    } else {
      const changeReason = dto.changeReason?.trim() ? dto.changeReason.trim() : '空白版本';
      await this.repo.createBlankDraftVersion(promptId, actor.sub, changeReason);
    }

    return this.getPrompt(projectId, promptId, actor);
  }

  async deleteDraftVersion(
    projectId: string,
    promptId: string,
    versionId: string,
    actor: CurrentUserPayload,
  ): Promise<void> {
    await this.getWritableProject(projectId, actor);

    const prompt = await this.repo.findPromptById(projectId, promptId);
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const version = await this.repo.findVersionInPrompt(promptId, versionId);
    if (!version) {
      throw new NotFoundException(`Prompt version ${versionId} not found`);
    }
    await this.buildDeletionImpact(projectId, promptId, [version], false);

    await this.repo.deleteDraftVersionHard(promptId, versionId);
  }

  async getPromptDeleteImpact(
    projectId: string,
    promptId: string,
    actor: CurrentUserPayload,
  ): Promise<PromptDeletionImpactDto> {
    await this.getAccessibleProject(projectId, actor);

    const prompt = await this.repo.findPromptById(projectId, promptId);
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const versions = await this.repo.listVersionsByPromptIds([promptId]);
    return this.buildDeletionImpact(projectId, promptId, versions, true);
  }

  async getPromptVersionDeleteImpact(
    projectId: string,
    promptId: string,
    versionId: string,
    actor: CurrentUserPayload,
  ): Promise<PromptDeletionImpactDto> {
    await this.getAccessibleProject(projectId, actor);

    const prompt = await this.repo.findPromptById(projectId, promptId);
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const version = await this.repo.findVersionInPrompt(promptId, versionId);
    if (!version) {
      throw new NotFoundException(`Prompt version ${versionId} not found`);
    }

    return this.buildDeletionImpact(projectId, promptId, [version], false);
  }

  async deletePrompt(projectId: string, promptId: string, actor: CurrentUserPayload): Promise<void> {
    await this.getWritableProject(projectId, actor);

    const prompt = await this.repo.findPromptById(projectId, promptId);
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const versions = await this.repo.listVersionsByPromptIds([promptId]);
    await this.buildDeletionImpact(projectId, promptId, versions, true);

    await this.repo.hardDeletePrompt(projectId, promptId);
  }

  async updateVersionLabel(
    projectId: string,
    promptId: string,
    dto: UpdatePromptVersionLabelDto,
    actor: CurrentUserPayload,
  ): Promise<PromptDetailDto> {
    await this.getWritableProject(projectId, actor);

    const prompt = await this.repo.findPromptById(projectId, promptId);
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const label = dto.label.trim();
    if (label === DERIVED_LATEST_LABEL) {
      throw new BadRequestException('prompt_label_latest_is_system_managed');
    }

    if (dto.versionId === null) {
      await this.repo.deleteVersionLabel(promptId, label);
      return this.getPrompt(projectId, promptId, actor);
    }

    const version = await this.repo.findVersionInPrompt(promptId, dto.versionId);
    if (!version) {
      throw new NotFoundException(`Prompt version ${dto.versionId} not found`);
    }

    await this.repo.upsertVersionLabel({
      promptId,
      versionId: dto.versionId,
      label,
      labelType: MOVABLE_SYSTEM_LABELS.has(label) ? 'system' : 'custom',
      actorUserId: actor.sub,
    });

    return this.getPrompt(projectId, promptId, actor);
  }

  async getPromptMetrics(projectId: string, promptId: string, actor: CurrentUserPayload): Promise<PromptMetricsDto> {
    await this.getAccessibleProject(projectId, actor);

    const prompt = await this.repo.findPromptById(projectId, promptId);
    if (!prompt) {
      throw new NotFoundException(`Prompt ${promptId} not found`);
    }

    const versions = await this.repo.listVersionsByPromptIds([promptId]);
    const [labels, metricRows] = await Promise.all([
      this.repo.listLabelsByPromptIds([promptId]),
      this.repo.aggregateMetricsByVersionIds(
        projectId,
        versions.map((version) => version.id),
      ),
    ]);
    const labelsByVersion = this.buildLabelsByVersion(promptId, versions, labels);
    const metricsByVersionId = new Map(metricRows.map((row) => [row.promptVersionId, row]));

    const versionMetrics = versions
      .map((version) => {
        const metrics = metricsByVersionId.get(version.id);
        const correctCount = this.toInteger(metrics?.correctCount);
        const incorrectCount = this.toInteger(metrics?.incorrectCount);
        const judgedCount = correctCount + incorrectCount;

        return {
          promptVersionId: version.id,
          versionNumber: version.versionNumber,
          status: this.toVersionStatus(version.isFrozen),
          labels: labelsByVersion.get(version.id) ?? [],
          runCount: this.toInteger(metrics?.runCount),
          successCount: this.toInteger(metrics?.successCount),
          errorCount: this.toInteger(metrics?.errorCount),
          correctCount,
          incorrectCount,
          accuracy: judgedCount > 0 ? correctCount / judgedCount : null,
          medianLatencyMs: this.toNullableNumber(metrics?.medianLatencyMs),
          medianInputTokens: this.toNullableNumber(metrics?.medianInputTokens),
          medianOutputTokens: this.toNullableNumber(metrics?.medianOutputTokens),
          totalInputTokens: this.toInteger(metrics?.totalInputTokens),
          totalOutputTokens: this.toInteger(metrics?.totalOutputTokens),
          totalCostEstimate: this.toNumber(metrics?.totalCostEstimate),
          firstRunAt: metrics?.firstRunAt?.toISOString() ?? null,
          lastRunAt: metrics?.lastRunAt?.toISOString() ?? null,
        };
      })
      .sort((left, right) => right.versionNumber - left.versionNumber);

    return {
      promptId,
      versions: versionMetrics,
      totals: versionMetrics.reduce(
        (acc, item) => ({
          runCount: acc.runCount + item.runCount,
          successCount: acc.successCount + item.successCount,
          errorCount: acc.errorCount + item.errorCount,
          totalInputTokens: acc.totalInputTokens + item.totalInputTokens,
          totalOutputTokens: acc.totalOutputTokens + item.totalOutputTokens,
          totalCostEstimate: acc.totalCostEstimate + item.totalCostEstimate,
        }),
        {
          runCount: 0,
          successCount: 0,
          errorCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostEstimate: 0,
        },
      ),
    };
  }

  private async getAccessibleProject(projectId: string, actor: CurrentUserPayload): Promise<PromptProjectAccessRow> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const project = await this.repo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }

  private async getWritableProject(projectId: string, actor: CurrentUserPayload): Promise<PromptProjectAccessRow> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    return this.getAccessibleProject(projectId, actor);
  }

  private async createPromptOrThrowNameConflict(projectId: string, dto: CreatePromptDto, actorUserId: string) {
    try {
      return await this.repo.createPrompt(projectId, dto, actorUserId);
    } catch (error) {
      if (isPromptNameUniqueViolation(error)) {
        throw new ConflictException('prompt_name_taken');
      }
      throw error;
    }
  }

  private groupVersions(versions: PromptVersionRow[]) {
    const groups = new Map<string, PromptVersionRow[]>();
    for (const version of versions) {
      const current = groups.get(version.promptId) ?? [];
      current.push(version);
      groups.set(version.promptId, current);
    }
    return groups;
  }

  private groupLabels(labels: PromptVersionLabelRow[]) {
    const groups = new Map<string, PromptVersionLabelRow[]>();
    for (const label of labels) {
      const current = groups.get(label.promptId) ?? [];
      current.push(label);
      groups.set(label.promptId, current);
    }
    return groups;
  }

  private async getReferenceCounts(versions: PromptVersionRow[]) {
    const references = await this.repo.listExperimentReferencesByVersionIds(versions.map((version) => version.id));
    const counts = new Map<string, number>();
    for (const reference of references) {
      counts.set(reference.promptVersionId, (counts.get(reference.promptVersionId) ?? 0) + 1);
    }
    return counts;
  }

  private async buildDeletionImpact(
    projectId: string,
    promptId: string,
    versions: PromptVersionRow[],
    includePromptShell: boolean,
  ): Promise<PromptDeletionImpactDto> {
    const versionIds = versions.map((version) => version.id);
    const generatedOptimizationIds = versions
      .map((version) => version.generatedByOptimizationId)
      .filter((id): id is string => Boolean(id));
    const rows = await this.repo.listDeletionImpact({
      projectId,
      promptId,
      versionIds,
      generatedOptimizationIds,
      includePromptShell,
    });

    const experiments = rows.experiments.map((row) => this.toDeletionImpactItem(row, 'experiment'));
    const optimizations = rows.optimizations.map((row) => this.toDeletionImpactItem(row, 'optimization'));
    const canaryReleases = rows.canaryReleases.map((row) => this.toDeletionImpactItem(row, 'canary_release'));
    const productionReleases = rows.productionReleases.map((row) =>
      this.toDeletionImpactItem(row, 'production_release'),
    );

    return {
      promptId,
      versionId: includePromptShell ? null : (versions[0]?.id ?? null),
      experiments,
      optimizations,
      canaryReleases,
      productionReleases,
      total: experiments.length + optimizations.length + canaryReleases.length + productionReleases.length,
    };
  }

  private toDeletionImpactItem(
    row: PromptDeletionImpactRow,
    kind: PromptDeletionImpactItemDto['kind'],
  ): PromptDeletionImpactItemDto {
    return {
      id: row.id,
      kind,
      name: row.name,
      status: row.status,
      promptId: row.promptId,
      promptVersionId: row.promptVersionId,
      promptVersionNumber: row.promptVersionNumber,
      createdAt: row.createdAt?.toISOString() ?? null,
    };
  }

  private toPromptListItem(
    row: PromptRow,
    versions: PromptVersionRow[],
    references: Map<string, number>,
    labels: PromptVersionLabelRow[] = [],
  ): PromptListItemDto {
    const sortedVersions = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
    const latest = sortedVersions[0];
    const onlineVersion = row.currentOnlineVersionId
      ? sortedVersions.find((version) => version.id === row.currentOnlineVersionId)
      : null;
    const versionsById = new Map(sortedVersions.map((version) => [version.id, version]));
    const grayVersion = labels.find((label) => label.label === 'gray');
    const customLabels = labels
      .filter((label) => label.labelType === 'custom')
      .map((label) => {
        const version = versionsById.get(label.versionId);
        if (!version) return null;
        return {
          name: label.label,
          versionNumber: version.versionNumber,
        };
      })
      .filter((label): label is { name: string; versionNumber: number } => label !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
    const activeReferences = sortedVersions.reduce((sum, version) => sum + (references.get(version.id) ?? 0), 0);

    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      defaultDatasetId: row.defaultDatasetId,
      defaultDatasetName: row.defaultDatasetName,
      latestVersionNumber: latest?.versionNumber ?? 1,
      currentOnlineVersionNumber: onlineVersion?.versionNumber ?? null,
      currentGrayVersionNumber: grayVersion ? (versionsById.get(grayVersion.versionId)?.versionNumber ?? null) : null,
      customLabels,
      latestVersionStatus: this.toVersionStatus(latest?.isFrozen ?? false),
      createdBy: row.createdBy,
      createdByDisplayName: row.createdByDisplayName ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      activeReferences,
    };
  }

  private toPromptDetail(
    row: PromptRow,
    versions: PromptVersionRow[],
    references: Map<string, number>,
    labels: PromptVersionLabelRow[] = [],
  ): PromptDetailDto {
    const labelsByVersion = this.buildLabelsByVersion(row.id, versions, labels);
    return {
      ...this.toPromptListItem(row, versions, references, labels),
      versions: versions
        .map((version) => this.toPromptVersion(version, labelsByVersion.get(version.id) ?? []))
        .sort((left, right) => right.versionNumber - left.versionNumber),
    };
  }

  private toPromptVersion(row: PromptVersionRow, labels: PromptVersionLabelDto[] = []): PromptVersionDto {
    return {
      id: row.id,
      promptId: row.promptId,
      versionNumber: row.versionNumber,
      status: this.toVersionStatus(row.isFrozen),
      body: row.body ?? '',
      variables: this.toVariables(row.variables),
      outputSchema: this.toOutputSchema(row.outputSchema),
      judgmentRules: this.toJudgmentRules(row.judgmentRules),
      promptLanguage: this.toPromptLanguage(row.promptLanguage),
      parentVersionId: row.parentVersionId,
      generatedByOptimizationId: row.generatedByOptimizationId,
      changeReason: row.changeReason,
      labels,
      isFrozen: row.isFrozen,
      createdBy: row.createdBy,
      createdByDisplayName: row.createdByDisplayName ?? null,
      createdAt: row.createdAt.toISOString(),
      frozenAt: row.frozenAt?.toISOString() ?? null,
    };
  }

  private toVersionStatus(isFrozen: boolean): PromptVersionStatusDto {
    return isFrozen ? 'frozen' : 'editable';
  }

  private toPromptLanguage(language: string) {
    const parse = promptLanguageSchema.safeParse(language);
    return parse.success ? parse.data : DEFAULT_PROMPT_LANGUAGE;
  }

  private toVariables(value: unknown): PromptVariableDto[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => promptVariableSchema.safeParse(item))
      .filter((parse): parse is { success: true; data: PromptVariableDto } => parse.success)
      .map((parse) => parse.data);
  }

  private toOutputSchema(value: unknown): PromptOutputSchemaDto {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rawFields = (value as { fields?: unknown }).fields;
    if (!Array.isArray(rawFields)) return { fields: [] };
    const fields = rawFields
      .filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === 'object')
      .map((field) => ({
        key: String(field.key ?? field.name ?? '').trim(),
        value: String(field.value ?? field.description ?? '').trim(),
        isJudgment: Boolean(field.isJudgment ?? field.is_decision ?? field.judgment),
      }))
      .filter((field) => field.key.length > 0);
    return { fields };
  }

  private toJudgmentRules(value: unknown): PromptJudgmentRulesDto {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private buildLabelsByVersion(
    promptId: string,
    versions: PromptVersionRow[],
    labels: PromptVersionLabelRow[],
  ): Map<string, PromptVersionLabelDto[]> {
    const labelsByVersion = new Map<string, PromptVersionLabelDto[]>();
    for (const label of labels) {
      if (label.promptId !== promptId) continue;
      const current = labelsByVersion.get(label.versionId) ?? [];
      current.push({
        name: label.label,
        type: label.labelType === 'system' ? 'system' : 'custom',
      });
      labelsByVersion.set(label.versionId, current);
    }

    const latest = [...versions].sort((left, right) => right.versionNumber - left.versionNumber)[0];
    if (latest) {
      const current = labelsByVersion.get(latest.id) ?? [];
      current.push({ name: DERIVED_LATEST_LABEL, type: 'system' });
      labelsByVersion.set(latest.id, current);
    }

    for (const [versionId, versionLabels] of labelsByVersion.entries()) {
      labelsByVersion.set(versionId, this.sortLabels(versionLabels));
    }
    return labelsByVersion;
  }

  private sortLabels(labels: PromptVersionLabelDto[]): PromptVersionLabelDto[] {
    const rank = new Map([
      [DERIVED_LATEST_LABEL, 0],
      ['gray', 1],
      ['production', 2],
    ]);
    return Array.from(new Map(labels.map((label) => [label.name, label])).values()).sort((left, right) => {
      const leftRank = rank.get(left.name) ?? 10;
      const rightRank = rank.get(right.name) ?? 10;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.name.localeCompare(right.name);
    });
  }

  private toInteger(value: number | string | null | undefined): number {
    return Math.trunc(this.toNumber(value));
  }

  private toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toNullableNumber(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

function isPromptNameUniqueViolation(error: unknown): boolean {
  return isUniqueViolation(error, /idx_prompts_project_name_active/);
}
