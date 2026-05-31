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
    const [availableCount, categoryOptions] = await Promise.all([
      this.repo.countMatchingRunResults(projectId, input.releaseLineId, input.releaseVariantId, input.scope),
      this.repo.findVariantCategoryOptions(projectId, input.releaseLineId, input.releaseVariantId),
    ]);
    if (input.sampleSize > availableCount) {
      throw new BadRequestException({
        code: 'annotation_sample_size_exceeds_available',
        availableCount,
        sampleSize: input.sampleSize,
      });
    }
    if (categoryOptions.length === 0) {
      throw new BadRequestException({
        code: 'annotation_category_options_required',
        message: 'Annotation task requires prompt classification options',
      });
    }
    const taskId = await this.repo.createTask(projectId, input, actor.sub, availableCount, categoryOptions);
    this.logger.info(
      {
        annotationTaskId: taskId,
        releaseLineId: input.releaseLineId,
        releaseVariantId: input.releaseVariantId,
        scope: input.scope,
        sampleSize: input.sampleSize,
        categoryOptionCount: categoryOptions.length,
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
