import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AnnotationSampleDto, AnnotationTaskDto, CreateAnnotationTaskInputDto } from '@proofhound/shared';
import type { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { AnnotationService } from '../annotation.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';

const projectId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const taskId = '33333333-3333-4333-8333-333333333333';
const annotationId = '44444444-4444-4444-8444-444444444444';
const releaseLineId = '55555555-5555-4555-8555-555555555555';
const releaseVersionId = '66666666-6666-4666-8666-666666666666';

const actor: CurrentUserPayload = {
  sub: actorId,
  email: 'annotator@example.com',
  isActive: true,
  isSuperAdmin: false,
};

const createInput: CreateAnnotationTaskInputDto = {
  name: 'annotation-20260524',
  releaseLineId,
  releaseVersionId,
  releaseVersionScope: 'exact',
  scope: 'all',
  samplingMode: 'random',
  sampleSize: 2,
};

function task(overrides: Partial<AnnotationTaskDto> = {}): AnnotationTaskDto {
  return {
    id: taskId,
    projectId,
    name: 'annotation-20260524',
    scope: 'all',
    releaseLineId,
    releaseLineName: 'support-line',
    releaseVersionId,
    releaseVersionLabel: 'v1',
    releaseVersionScope: 'exact',
    promptName: 'support-classifier',
    promptVersionId: '77777777-7777-4777-8777-777777777777',
    promptVersionNumber: 1,
    promptVersionLabel: 'v1',
    categoryOptions: ['退款', '物流', '其他'],
    modelId: '88888888-8888-4888-8888-888888888888',
    modelName: 'gpt-test',
    modelProvider: 'openai',
    status: 'active',
    progress: { total: 2, pending: 1, claimed: 1, submitted: 0 },
    quality: null,
    createdBy: actorId,
    createdAt: '2026-05-24T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z',
    ...overrides,
  };
}

function sample(overrides: Partial<AnnotationSampleDto> = {}): AnnotationSampleDto {
  return {
    id: annotationId,
    taskId,
    runResultId: '99999999-9999-4999-8999-999999999999',
    externalId: null,
    inputPreview: null,
    outputPreview: null,
    inputVariables: null,
    renderedPrompt: null,
    decisionOutput: '退款',
    expectedOutput: null,
    annotatedExpectedOutput: '退款 或 物流',
    isCorrect: false,
    rawResponse: null,
    parsedOutput: null,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    notes: null,
    lockedBy: actorId,
    lockedAt: '2026-05-24T00:00:00.000Z',
    lockHeartbeatAt: '2026-05-24T00:00:00.000Z',
    submittedAt: '2026-05-24T00:00:00.000Z',
    submittedBy: actorId,
    createdAt: '2026-05-24T00:00:00.000Z',
    ...overrides,
  };
}

function repoMock(overrides: Record<string, unknown> = {}) {
  return {
    findProject: vi.fn().mockResolvedValue({ id: projectId }),
    listTasks: vi.fn(),
    listOptions: vi.fn(),
    findTask: vi.fn().mockResolvedValue(task()),
    countMatchingRunResults: vi.fn().mockResolvedValue(2),
    countMatchingRunResultsByCategory: vi.fn().mockResolvedValue(new Map([['退款', 1]])),
    findReleaseVersionCategoryOptions: vi.fn().mockResolvedValue({
      compatible: true,
      options: ['退款', '物流', '其他'],
    }),
    createTask: vi.fn().mockResolvedValue(taskId),
    listSamples: vi.fn(),
    countSamples: vi.fn(),
    claimSamples: vi.fn(),
    submitSample: vi.fn().mockResolvedValue(sample()),
    releaseSample: vi.fn(),
    ...overrides,
  };
}

describe('AnnotationService', () => {
  it('requires prompt-derived category options when creating a task', async () => {
    const repo = repoMock({
      findReleaseVersionCategoryOptions: vi.fn().mockResolvedValue({ compatible: true, options: [] }),
    });
    const service = new AnnotationService(repo as never, new LocalAccessControlService());

    await expect(service.createTask(projectId, createInput, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createTask).not.toHaveBeenCalled();
  });

  it('freezes category options into newly created tasks', async () => {
    const repo = repoMock();
    const service = new AnnotationService(repo as never, new LocalAccessControlService());

    await service.createTask(projectId, createInput, actor);

    expect(repo.createTask).toHaveBeenCalledWith(projectId, createInput, actorId, 2, ['退款', '物流', '其他']);
  });

  it('rejects per-category sample counts that exceed current run result categories', async () => {
    const repo = repoMock({
      countMatchingRunResults: vi.fn().mockResolvedValue(3),
      countMatchingRunResultsByCategory: vi.fn().mockResolvedValue(new Map([['退款', 1]])),
    });
    const service = new AnnotationService(repo as never, new LocalAccessControlService());

    await expect(
      service.createTask(
        projectId,
        {
          ...createInput,
          samplingMode: 'per_category',
          sampleSize: 2,
          categorySampleCounts: [{ category: '退款', sampleSize: 2 }],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createTask).not.toHaveBeenCalled();
  });

  it('submits the selected category as the expected_output annotation value', async () => {
    const repo = repoMock();
    const service = new AnnotationService(repo as never, new LocalAccessControlService());

    await service.submitSample(projectId, taskId, { annotationId, expectedOutput: '退款', notes: null }, actor);

    expect(repo.submitSample).toHaveBeenCalledWith(taskId, annotationId, actorId, {
      expectedOutput: '退款',
      notes: null,
    });
  });

  it('rejects multiple categories for a single classification annotation', async () => {
    const repo = repoMock();
    const service = new AnnotationService(repo as never, new LocalAccessControlService());

    await expect(
      service.submitSample(projectId, taskId, { annotationId, expectedOutput: '退款 或 物流', notes: null }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.submitSample).not.toHaveBeenCalled();
  });

  it('rejects categories that are not in the task options', async () => {
    const repo = repoMock();
    const service = new AnnotationService(repo as never, new LocalAccessControlService());

    await expect(
      service.submitSample(projectId, taskId, { annotationId, expectedOutput: '售后', notes: null }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.submitSample).not.toHaveBeenCalled();
  });
});
