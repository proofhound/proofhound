import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import {
  formatClassificationAnnotationValue,
  normalizeClassificationAnnotationValue,
  parseClassificationAnnotationValue,
} from '@proofhound/shared';
import type {
  AnnotationSampleDto,
  AnnotationSampleListResponseDto,
  AnnotationSampleStatusDto,
  AnnotationTaskDto,
  AnnotationTaskListResponseDto,
  AnnotationTaskOptionsResponseDto,
  ClaimAnnotationSamplesInputDto,
  ClaimAnnotationSamplesResponseDto,
  CreateAnnotationTaskInputDto,
  ReleaseAnnotationSampleInputDto,
  SubmitAnnotationSampleInputDto,
} from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { AnnotationRepository } from './annotation.repository';

@Injectable()
export class AnnotationService {
  private readonly logger = createLogger('annotation.service', { service: 'server' });

  constructor(
    private readonly repo: AnnotationRepository,
    private readonly accessControl: AccessControlService,
  ) {}

  async listTasks(projectId: string, actor: CurrentUserPayload): Promise<AnnotationTaskListResponseDto> {
    await this.assertReadAccess(projectId, actor);
    const data = await this.repo.listTasks(projectId);
    return { data, total: data.length };
  }

  async listOptions(projectId: string, actor: CurrentUserPayload): Promise<AnnotationTaskOptionsResponseDto> {
    await this.assertReadAccess(projectId, actor);
    const data = await this.repo.listOptions(projectId);
    return { data, total: data.length };
  }

  async getTask(projectId: string, taskId: string, actor: CurrentUserPayload): Promise<AnnotationTaskDto> {
    await this.assertReadAccess(projectId, actor);
    const task = await this.repo.findTask(projectId, taskId);
    if (!task) throw new NotFoundException(`Annotation task ${taskId} not found`);
    return task;
  }

  async createTask(
    projectId: string,
    input: CreateAnnotationTaskInputDto,
    actor: CurrentUserPayload,
  ): Promise<AnnotationTaskDto> {
    await this.assertWriteAccess(projectId, actor);
    const requestedSampleSize = getRequestedSampleSize(input);
    const [availableCount, categoryResult, categoryAvailability] = await Promise.all([
      this.repo.countMatchingRunResults(
        projectId,
        input.releaseLineId,
        input.releaseVersionId,
        input.releaseVersionScope,
        input.scope,
      ),
      this.repo.findReleaseVersionCategoryOptions(
        projectId,
        input.releaseLineId,
        input.releaseVersionId,
        input.releaseVersionScope,
      ),
      input.samplingMode === 'per_category'
        ? this.repo.countMatchingRunResultsByCategory(
            projectId,
            input.releaseLineId,
            input.releaseVersionId,
            input.releaseVersionScope,
            input.scope,
          )
        : Promise.resolve(new Map<string, number>()),
    ]);
    if (requestedSampleSize > availableCount) {
      throw new BadRequestException({
        code: 'annotation_sample_size_exceeds_available',
        availableCount,
        sampleSize: requestedSampleSize,
      });
    }
    if (!categoryResult.compatible) {
      throw new BadRequestException({
        code: 'annotation_release_journey_categories_incompatible',
        message: 'Release journey annotation requires compatible category options',
      });
    }
    if (categoryResult.options.length === 0) {
      throw new BadRequestException({
        code: 'annotation_category_options_required',
        message: 'Annotation task requires prompt classification options',
      });
    }
    if (input.samplingMode === 'per_category') {
      validateCategorySampleCounts(input, categoryResult.options, categoryAvailability);
    }
    const taskId = await this.repo.createTask(projectId, input, actor.sub, availableCount, categoryResult.options);
    this.logger.info(
      {
        annotationTaskId: taskId,
        releaseLineId: input.releaseLineId,
        releaseVersionId: input.releaseVersionId,
        releaseVersionScope: input.releaseVersionScope,
        scope: input.scope,
        samplingMode: input.samplingMode,
        sampleSize: requestedSampleSize,
        categorySampleCounts: getPositiveCategorySampleCounts(input),
        categoryOptionCount: categoryResult.options.length,
      },
      'annotation_task_created',
    );
    return this.getTask(projectId, taskId, actor);
  }

  async listSamples(
    projectId: string,
    taskId: string,
    filter: { status?: AnnotationSampleStatusDto; limit: number; offset: number },
    actor: CurrentUserPayload,
  ): Promise<AnnotationSampleListResponseDto> {
    await this.getTask(projectId, taskId, actor);
    const [data, total] = await Promise.all([
      this.repo.listSamples(taskId, filter),
      this.repo.countSamples(taskId, filter.status),
    ]);
    return { data, total };
  }

  async claimSamples(
    projectId: string,
    taskId: string,
    input: ClaimAnnotationSamplesInputDto,
    actor: CurrentUserPayload,
  ): Promise<ClaimAnnotationSamplesResponseDto> {
    await this.assertWriteAccess(projectId, actor);
    await this.ensureTask(projectId, taskId);
    const data = await this.repo.claimSamples(taskId, actor.sub, input.batchSize);
    return { data, claimedCount: data.length };
  }

  async submitSample(
    projectId: string,
    taskId: string,
    input: SubmitAnnotationSampleInputDto,
    actor: CurrentUserPayload,
  ): Promise<AnnotationSampleDto> {
    await this.assertWriteAccess(projectId, actor);
    const task = await this.ensureTask(projectId, taskId);
    const selectedCategories = parseClassificationAnnotationValue(input.expectedOutput, task.categoryOptions);
    const selectedCategory = normalizeClassificationAnnotationValue(input.expectedOutput, task.categoryOptions);
    const invalidCategories = selectedCategories.filter((category) => !task.categoryOptions.includes(category));
    if (
      task.categoryOptions.length === 0 ||
      !selectedCategory ||
      selectedCategories.length !== 1 ||
      invalidCategories.length > 0
    ) {
      throw new BadRequestException({
        code: 'annotation_category_options_invalid',
        categoryOptions: task.categoryOptions,
        selectedCategories,
        invalidCategories,
      });
    }
    const updated = await this.repo.submitSample(taskId, input.annotationId, actor.sub, {
      expectedOutput: formatClassificationAnnotationValue(selectedCategory),
      notes: input.notes,
    });
    if (!updated)
      throw new NotFoundException(`Annotation ${input.annotationId} not owned by actor or already submitted`);
    return updated;
  }

  async releaseSample(
    projectId: string,
    taskId: string,
    input: ReleaseAnnotationSampleInputDto,
    actor: CurrentUserPayload,
  ): Promise<AnnotationSampleDto> {
    await this.assertWriteAccess(projectId, actor);
    await this.ensureTask(projectId, taskId);
    const updated = await this.repo.releaseSample(taskId, input.annotationId, actor.sub);
    if (!updated)
      throw new NotFoundException(`Annotation ${input.annotationId} not owned by actor or already submitted`);
    return updated;
  }

  private async ensureTask(projectId: string, taskId: string): Promise<AnnotationTaskDto> {
    const task = await this.repo.findTask(projectId, taskId);
    if (!task) throw new NotFoundException(`Annotation task ${taskId} not found`);
    return task;
  }

  private async assertReadAccess(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const project = await this.repo.findProject(projectId);
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
  }

  private async assertWriteAccess(projectId: string, actor: CurrentUserPayload): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    const project = await this.repo.findProject(projectId);
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
  }
}

function getRequestedSampleSize(input: CreateAnnotationTaskInputDto): number {
  if (input.samplingMode === 'per_category') {
    return getPositiveCategorySampleCounts(input).reduce((sum, item) => sum + item.sampleSize, 0);
  }
  return input.sampleSize ?? 0;
}

function getPositiveCategorySampleCounts(
  input: CreateAnnotationTaskInputDto,
): Array<{ category: string; sampleSize: number }> {
  return (input.categorySampleCounts ?? []).filter((item) => item.sampleSize > 0);
}

function validateCategorySampleCounts(
  input: CreateAnnotationTaskInputDto,
  categoryOptions: string[],
  categoryAvailability: Map<string, number>,
): void {
  const allowedCategories = new Set(categoryOptions);
  const requestedCounts = getPositiveCategorySampleCounts(input);
  const invalidCategories = requestedCounts
    .map((item) => item.category)
    .filter((category) => !allowedCategories.has(category));
  if (invalidCategories.length > 0) {
    throw new BadRequestException({
      code: 'annotation_category_sample_options_invalid',
      categoryOptions,
      invalidCategories,
    });
  }

  const exceeded = requestedCounts
    .map((item) => ({
      category: item.category,
      availableCount: categoryAvailability.get(item.category) ?? 0,
      sampleSize: item.sampleSize,
    }))
    .find((item) => item.sampleSize > item.availableCount);
  if (exceeded) {
    throw new BadRequestException({
      code: 'annotation_category_sample_size_exceeds_available',
      ...exceeded,
    });
  }
}
