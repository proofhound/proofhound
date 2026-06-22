import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PromptRepository,
  type PromptProjectAccessRow,
  type PromptRow,
  type PromptVersionRow,
} from '../prompt.repository';
import { LocalPromptDeletionHook, PromptDeletionHook } from '../prompt-deletion.hook';
import { PromptService } from '../prompt.service';
import { AccessControlService } from '../../../common/contracts/access-control.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import { vi, type Mocked } from 'vitest';

const projectId = '77777777-7777-4777-8777-777777777777';
const promptId = '77772000-0000-4000-8000-000000000001';
const draftVersionId = '77773000-0000-4000-8000-000000000001';
const onlineVersionId = '77773000-0000-4000-8000-000000000002';
const datasetId = '77770000-0000-4000-8000-000000000001';
const datasetAltId = '77770000-0000-4000-8000-000000000002';

const actor = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'alice@example.com',
  isSuperAdmin: false,
  isActive: true,
};

const projectAccess = (): PromptProjectAccessRow => ({
  id: projectId,
});

const promptRow = (overrides: Partial<PromptRow> = {}): PromptRow => ({
  id: promptId,
  projectId,
  name: 'ChnSentiCorp 情感判定',
  status: 'active',
  currentOnlineVersionId: onlineVersionId,
  defaultDatasetId: datasetId,
  defaultDatasetName: '@datasets/chnsenticorp/subsets/random-50',
  createdBy: actor.sub,
  createdByDisplayName: 'Alice',
  createdAt: new Date('2026-05-18T08:00:00Z'),
  updatedAt: new Date('2026-05-18T09:00:00Z'),
  archivedAt: null,
  deletedAt: null,
  ...overrides,
});

const versionRow = (overrides: Partial<PromptVersionRow> = {}): PromptVersionRow => ({
  id: draftVersionId,
  promptId,
  versionNumber: 2,
  body: '判断 {{text}} 的情感。',
  variables: [{ name: 'text', type: 'text', required: true, description: '评论正文', datasetField: 'text' }],
  outputSchema: { fields: [{ key: 'label', value: 'positive 或 negative', isJudgment: true }] },
  judgmentRules: { mode: 'exact_match', expected_field: 'expected_output', decision_field: 'label' },
  parentVersionId: onlineVersionId,
  generatedByOptimizationId: null,
  changeReason: '补充解释',
  isFrozen: false,
  createdBy: actor.sub,
  createdByDisplayName: 'Alice',
  createdAt: new Date('2026-05-18T09:00:00Z'),
  frozenAt: null,
  ...overrides,
  promptLanguage: overrides.promptLanguage ?? 'zh-CN',
});

function makeRepo(): Mocked<PromptRepository> {
  return {
    findProjectAccess: vi.fn(),
    listPrompts: vi.fn(),
    findPromptById: vi.fn(),
    findPromptByProjectAndName: vi.fn(),
    findDatasetInProject: vi.fn(),
    listVersionsByPromptIds: vi.fn(),
    listLabelsByPromptIds: vi.fn().mockResolvedValue([]),
    aggregateMetricsByVersionIds: vi.fn().mockResolvedValue([]),
    listExperimentReferencesByVersionIds: vi.fn().mockResolvedValue([]),
    listDeletionImpact: vi.fn().mockResolvedValue({
      releaseLines: [],
      experiments: [],
      optimizations: [],
    }),
    createPrompt: vi.fn(),
    archivePrompt: vi.fn(),
    restorePrompt: vi.fn(),
    updateDraftVersion: vi.fn(),
    updatePromptDefaultDataset: vi.fn(),
    hardDeletePrompt: vi.fn(),
    findVersionInPrompt: vi.fn(),
    upsertVersionLabel: vi.fn(),
    deleteVersionLabel: vi.fn(),
    createDraftVersionFromSource: vi.fn(),
    createBlankDraftVersion: vi.fn(),
    deleteDraftVersionHard: vi.fn(),
  } as unknown as Mocked<PromptRepository>;
}

describe('PromptService', () => {
  let service: PromptService;
  let repo: Mocked<PromptRepository>;

  beforeEach(async () => {
    repo = makeRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PromptRepository, useValue: repo },
        { provide: AccessControlService, useClass: LocalAccessControlService },
        { provide: PromptDeletionHook, useClass: LocalPromptDeletionHook },
        PromptService,
      ],
    }).compile();

    service = module.get(PromptService);
  });

  it('lists prompts with version pointers and custom labels from real rows', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.listPrompts.mockResolvedValue([promptRow()]);
    repo.listVersionsByPromptIds.mockResolvedValue([
      versionRow(),
      versionRow({ id: onlineVersionId, versionNumber: 1, isFrozen: true }),
    ]);
    repo.listLabelsByPromptIds.mockResolvedValue([
      {
        promptId,
        versionId: draftVersionId,
        label: 'canary',
        labelType: 'system',
        createdAt: new Date('2026-05-18T08:00:00Z'),
        updatedAt: new Date('2026-05-18T08:00:00Z'),
      },
      {
        promptId,
        versionId: onlineVersionId,
        label: 'staging',
        labelType: 'custom',
        createdAt: new Date('2026-05-18T08:00:00Z'),
        updatedAt: new Date('2026-05-18T08:00:00Z'),
      },
    ]);

    const result = await service.listPrompts(projectId, actor);

    expect(repo.listLabelsByPromptIds).toHaveBeenCalledWith([promptId]);
    expect(result.data[0]).toMatchObject({
      id: promptId,
      latestVersionNumber: 2,
      currentOnlineVersionNumber: 1,
      currentCanaryVersionNumber: 2,
      customLabels: [{ name: 'staging', versionNumber: 1 }],
      latestVersionStatus: 'editable',
      activeReferences: 0,
    });
  });

  it('updates only editable versions', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptById.mockResolvedValue(promptRow());
    repo.listVersionsByPromptIds.mockResolvedValue([versionRow()]);
    repo.updateDraftVersion.mockResolvedValue(undefined);

    const dto = {
      body: '更新后的 {{text}} 情感判定。',
      variables: [
        { name: 'text', type: 'text' as const, required: true, description: '评论正文', datasetField: 'text' },
      ],
      outputSchema: { fields: [{ key: 'label', value: 'positive 或 negative', isJudgment: true }] },
      judgmentRules: { mode: 'exact_match', expected_field: 'expected_output', decision_field: 'label' },
      changeReason: '人工编辑',
    };

    await service.updateDraftVersion(projectId, promptId, draftVersionId, dto, actor);

    expect(repo.updateDraftVersion).toHaveBeenCalledWith(projectId, promptId, draftVersionId, {
      ...dto,
      judgmentRules: {
        rules: [{ decisionField: 'label', expectedField: 'expected_output', operator: 'exact_match' }],
      },
    });
  });

  it('creates a prompt without a default dataset', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptByProjectAndName.mockResolvedValue(null);
    repo.createPrompt.mockResolvedValue({
      prompt: { id: promptId } as never,
      version: { id: draftVersionId } as never,
    });
    repo.findPromptById.mockResolvedValue(promptRow({ defaultDatasetId: null, defaultDatasetName: null }));
    repo.listVersionsByPromptIds.mockResolvedValue([versionRow()]);

    await service.createPrompt(projectId, { name: '未绑数据集的版本' }, actor);

    expect(repo.findDatasetInProject).not.toHaveBeenCalled();
    expect(repo.createPrompt).toHaveBeenCalledWith(projectId, { name: '未绑数据集的版本' }, actor.sub);
  });

  it('maps prompt name unique violations to prompt_name_taken', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptByProjectAndName.mockResolvedValue(null);
    repo.createPrompt.mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint "idx_prompts_project_name_active"'), {
        code: '23505',
        constraint: 'idx_prompts_project_name_active',
      }),
    );

    await expect(service.createPrompt(projectId, { name: '重复提示词' }, actor)).rejects.toThrow(
      new ConflictException('prompt_name_taken'),
    );
  });

  it('rejects createPrompt when an explicit default dataset is not in the project', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptByProjectAndName.mockResolvedValue(null);
    repo.findDatasetInProject.mockResolvedValue(null);

    await expect(
      service.createPrompt(projectId, { name: '新提示词', defaultDatasetId: datasetId }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repo.createPrompt).not.toHaveBeenCalled();
  });

  it('persists default dataset on createPrompt', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptByProjectAndName.mockResolvedValue(null);
    repo.findDatasetInProject.mockResolvedValue({ id: datasetId, name: 'ds' });
    repo.createPrompt.mockResolvedValue({
      prompt: { id: promptId } as never,
      version: { id: draftVersionId } as never,
    });
    repo.findPromptById.mockResolvedValue(promptRow());
    repo.listVersionsByPromptIds.mockResolvedValue([versionRow()]);

    await service.createPrompt(projectId, { name: '新提示词', defaultDatasetId: datasetId }, actor);

    expect(repo.createPrompt).toHaveBeenCalledWith(
      projectId,
      { name: '新提示词', defaultDatasetId: datasetId },
      actor.sub,
    );
  });

  it('updates default dataset binding when it changes', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptById.mockResolvedValue(promptRow({ defaultDatasetId: datasetId }));
    repo.listVersionsByPromptIds.mockResolvedValue([versionRow()]);
    repo.findDatasetInProject.mockResolvedValue({ id: datasetAltId, name: 'ds2' });
    repo.updatePromptDefaultDataset.mockResolvedValue(undefined);

    await service.updatePrompt(projectId, promptId, { defaultDatasetId: datasetAltId }, actor);

    expect(repo.updatePromptDefaultDataset).toHaveBeenCalledWith(projectId, promptId, datasetAltId);
  });

  it('keeps default dataset binding when updatePrompt target dataset matches current binding', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptById.mockResolvedValue(promptRow({ defaultDatasetId: datasetId }));
    repo.listVersionsByPromptIds.mockResolvedValue([versionRow()]);
    repo.findDatasetInProject.mockResolvedValue({ id: datasetId, name: 'ds' });

    await service.updatePrompt(projectId, promptId, { defaultDatasetId: datasetId }, actor);

    expect(repo.updatePromptDefaultDataset).not.toHaveBeenCalled();
  });

  it('archives and restores a prompt', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptById
      .mockResolvedValueOnce(promptRow())
      .mockResolvedValueOnce(promptRow({ status: 'archived', archivedAt: new Date('2026-05-19T00:00:00Z') }))
      .mockResolvedValueOnce(promptRow({ status: 'archived', archivedAt: new Date('2026-05-19T00:00:00Z') }))
      .mockResolvedValueOnce(promptRow());
    repo.listVersionsByPromptIds.mockResolvedValue([versionRow()]);

    const archived = await service.archivePrompt(projectId, promptId, actor);
    const restored = await service.restorePrompt(projectId, promptId, actor);

    expect(repo.archivePrompt).toHaveBeenCalledWith(projectId, promptId);
    expect(repo.restorePrompt).toHaveBeenCalledWith(projectId, promptId);
    expect(archived.status).toBe('archived');
    expect(restored.status).toBe('active');
  });

  it('rejects creating a draft version for archived prompts', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptById.mockResolvedValue(
      promptRow({ status: 'archived', archivedAt: new Date('2026-05-19T00:00:00Z') }),
    );

    await expect(service.createDraftVersion(projectId, promptId, {}, actor)).rejects.toBeInstanceOf(ConflictException);

    expect(repo.createBlankDraftVersion).not.toHaveBeenCalled();
  });

  it('returns persisted labels plus the derived latest label in prompt detail', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptById.mockResolvedValue(promptRow());
    repo.listVersionsByPromptIds.mockResolvedValue([
      versionRow(),
      versionRow({ id: onlineVersionId, versionNumber: 1, isFrozen: true }),
    ]);
    repo.listLabelsByPromptIds.mockResolvedValue([
      {
        promptId,
        versionId: onlineVersionId,
        label: 'production',
        labelType: 'system',
        createdAt: new Date('2026-05-18T08:00:00Z'),
        updatedAt: new Date('2026-05-18T08:00:00Z'),
      },
    ]);

    const detail = await service.getPrompt(projectId, promptId, actor);

    expect(detail.versions.find((version) => version.id === draftVersionId)?.labels).toEqual([
      { name: 'latest', type: 'system' },
    ]);
    expect(detail.versions.find((version) => version.id === onlineVersionId)?.labels).toEqual([
      { name: 'production', type: 'system' },
    ]);
  });

  it('moves a custom prompt version label', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptById.mockResolvedValue(promptRow());
    repo.findVersionInPrompt.mockResolvedValue(versionRow());
    repo.listVersionsByPromptIds.mockResolvedValue([versionRow()]);

    await service.updateVersionLabel(projectId, promptId, { label: 'staging', versionId: draftVersionId }, actor);

    expect(repo.upsertVersionLabel).toHaveBeenCalledWith({
      promptId,
      versionId: draftVersionId,
      label: 'staging',
      labelType: 'custom',
      actorUserId: actor.sub,
    });
  });

  it('rejects manual latest label updates', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptById.mockResolvedValue(promptRow());

    await expect(
      service.updateVersionLabel(projectId, promptId, { label: 'latest', versionId: draftVersionId }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repo.upsertVersionLabel).not.toHaveBeenCalled();
  });

  it('aggregates metrics per prompt version', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptById.mockResolvedValue(promptRow());
    repo.listVersionsByPromptIds.mockResolvedValue([
      versionRow(),
      versionRow({ id: onlineVersionId, versionNumber: 1, isFrozen: true }),
    ]);
    repo.listLabelsByPromptIds.mockResolvedValue([
      {
        promptId,
        versionId: draftVersionId,
        label: 'staging',
        labelType: 'custom',
        createdAt: new Date('2026-05-18T09:00:00Z'),
        updatedAt: new Date('2026-05-18T09:00:00Z'),
      },
    ]);
    repo.aggregateMetricsByVersionIds.mockResolvedValue([
      {
        promptVersionId: draftVersionId,
        runCount: 4,
        successCount: 3,
        errorCount: 1,
        correctCount: 2,
        incorrectCount: 1,
        medianLatencyMs: '120.5',
        medianInputTokens: '32',
        medianOutputTokens: '8',
        totalInputTokens: 128,
        totalOutputTokens: 32,
        totalCostEstimate: '0.0123',
        firstRunAt: new Date('2026-05-18T09:10:00Z'),
        lastRunAt: new Date('2026-05-18T09:20:00Z'),
      },
    ]);

    const metrics = await service.getPromptMetrics(projectId, promptId, actor);

    expect(metrics.totals).toMatchObject({
      runCount: 4,
      successCount: 3,
      errorCount: 1,
      totalInputTokens: 128,
      totalOutputTokens: 32,
      totalCostEstimate: 0.0123,
    });
    expect(metrics.versions[0]).toMatchObject({
      promptVersionId: draftVersionId,
      labels: [
        { name: 'latest', type: 'system' },
        { name: 'staging', type: 'custom' },
      ],
      accuracy: 2 / 3,
      medianLatencyMs: 120.5,
    });
    expect(metrics.versions[1]).toMatchObject({
      promptVersionId: onlineVersionId,
      runCount: 0,
      accuracy: null,
    });
  });

  it('rejects updates to frozen versions', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findPromptById.mockResolvedValue(promptRow());
    repo.listVersionsByPromptIds.mockResolvedValue([versionRow({ isFrozen: true })]);

    await expect(
      service.updateDraftVersion(
        projectId,
        promptId,
        draftVersionId,
        {
          body: '不能改',
          variables: [],
          outputSchema: { fields: [] },
          judgmentRules: { rules: [] },
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repo.updateDraftVersion).not.toHaveBeenCalled();
  });

  describe('createDraftVersion', () => {
    const newVersionId = '77773000-0000-4000-8000-0000000000aa';

    it('creates a version derived from an existing version', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findPromptById.mockResolvedValue(promptRow());
      repo.findVersionInPrompt.mockResolvedValue(versionRow({ id: onlineVersionId, versionNumber: 1, isFrozen: true }));
      repo.createDraftVersionFromSource.mockResolvedValue({
        versionId: newVersionId,
        versionNumber: 3,
        sourceVersionNumber: 1,
      });
      repo.listVersionsByPromptIds.mockResolvedValue([versionRow()]);

      await service.createDraftVersion(projectId, promptId, { sourceVersionId: onlineVersionId }, actor);

      expect(repo.createDraftVersionFromSource).toHaveBeenCalledWith(
        promptId,
        onlineVersionId,
        actor.sub,
        '基于 v1 复制',
      );
    });

    it('creates a blank editable version when no source version is provided', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findPromptById.mockResolvedValue(promptRow());
      repo.createBlankDraftVersion.mockResolvedValue({
        versionId: newVersionId,
        versionNumber: 3,
      });
      repo.listVersionsByPromptIds.mockResolvedValue([versionRow()]);

      await service.createDraftVersion(projectId, promptId, {}, actor);

      expect(repo.findVersionInPrompt).not.toHaveBeenCalled();
      expect(repo.createBlankDraftVersion).toHaveBeenCalledWith(promptId, actor.sub, '空白版本');
      expect(repo.createDraftVersionFromSource).not.toHaveBeenCalled();
    });

    it('uses provided changeReason verbatim when present', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findPromptById.mockResolvedValue(promptRow());
      repo.findVersionInPrompt.mockResolvedValue(versionRow({ id: onlineVersionId, versionNumber: 1 }));
      repo.createDraftVersionFromSource.mockResolvedValue({
        versionId: newVersionId,
        versionNumber: 3,
        sourceVersionNumber: 1,
      });
      repo.listVersionsByPromptIds.mockResolvedValue([versionRow()]);

      await service.createDraftVersion(
        projectId,
        promptId,
        { sourceVersionId: onlineVersionId, changeReason: '探索新分支' },
        actor,
      );

      expect(repo.createDraftVersionFromSource).toHaveBeenCalledWith(
        promptId,
        onlineVersionId,
        actor.sub,
        '探索新分支',
      );
    });

    it('rejects when source version does not exist', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findPromptById.mockResolvedValue(promptRow());
      repo.findVersionInPrompt.mockResolvedValue(null);

      await expect(
        service.createDraftVersion(projectId, promptId, { sourceVersionId: onlineVersionId }, actor),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(repo.createDraftVersionFromSource).not.toHaveBeenCalled();
    });
  });

  describe('deleteDraftVersion', () => {
    it('hard-deletes an unfrozen version', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findPromptById.mockResolvedValue(promptRow({ currentOnlineVersionId: onlineVersionId }));
      repo.findVersionInPrompt.mockResolvedValue(versionRow());

      await service.deleteDraftVersion(projectId, promptId, draftVersionId, actor);

      expect(repo.deleteDraftVersionHard).toHaveBeenCalledWith(projectId, promptId, draftVersionId);
      const deleteOrder = repo.deleteDraftVersionHard.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeDefined();
    });

    it('hard-deletes frozen versions after checking impact', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findPromptById.mockResolvedValue(promptRow());
      repo.findVersionInPrompt.mockResolvedValue(versionRow({ isFrozen: true }));

      await service.deleteDraftVersion(projectId, promptId, draftVersionId, actor);

      expect(repo.listDeletionImpact).toHaveBeenCalledWith({
        projectId,
        promptId,
        versionIds: [draftVersionId],
        generatedOptimizationIds: [],
        includePromptShell: false,
      });
      expect(repo.deleteDraftVersionHard).toHaveBeenCalledWith(projectId, promptId, draftVersionId);
    });

    it('lists impact before cascading the version delete', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findPromptById.mockResolvedValue(promptRow());
      repo.findVersionInPrompt.mockResolvedValue(versionRow());

      const impactSpy = vi.spyOn(repo, 'listDeletionImpact');

      await service.deleteDraftVersion(projectId, promptId, draftVersionId, actor);

      const impactOrder = impactSpy.mock.invocationCallOrder[0];
      const deleteOrder = repo.deleteDraftVersionHard.mock.invocationCallOrder[0];
      expect(impactOrder).toBeDefined();
      expect(deleteOrder).toBeDefined();
      expect(impactOrder ?? 0).toBeLessThan(deleteOrder ?? 0);
    });

    it('allows deleting the currently online version because releases keep snapshots', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findPromptById.mockResolvedValue(promptRow({ currentOnlineVersionId: draftVersionId }));
      repo.findVersionInPrompt.mockResolvedValue(versionRow());

      await service.deleteDraftVersion(projectId, promptId, draftVersionId, actor);

      expect(repo.deleteDraftVersionHard).toHaveBeenCalledWith(projectId, promptId, draftVersionId);
    });

    it('returns 404 when version not found', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findPromptById.mockResolvedValue(promptRow());
      repo.findVersionInPrompt.mockResolvedValue(null);

      await expect(service.deleteDraftVersion(projectId, promptId, draftVersionId, actor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getPromptDeleteImpact', () => {
    it('returns affected release lines, experiments and optimizations', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findPromptById.mockResolvedValue(promptRow());
      repo.listVersionsByPromptIds.mockResolvedValue([
        versionRow({ id: draftVersionId, generatedByOptimizationId: '77774000-0000-4000-8000-000000000001' }),
      ]);
      repo.listDeletionImpact.mockResolvedValue({
        releaseLines: [
          {
            id: '77776000-0000-4000-8000-000000000001',
            name: 'production line',
            status: 'running',
            promptId,
            promptVersionId: null,
            promptVersionNumber: null,
            createdAt: new Date('2026-05-18T11:00:00Z'),
          },
        ],
        experiments: [
          {
            id: '77775000-0000-4000-8000-000000000001',
            name: 'baseline',
            status: 'success',
            promptId,
            promptVersionId: draftVersionId,
            promptVersionNumber: 2,
            createdAt: new Date('2026-05-18T10:00:00Z'),
          },
        ],
        optimizations: [],
      });

      const impact = await service.getPromptDeleteImpact(projectId, promptId, actor);

      expect(repo.listDeletionImpact).toHaveBeenCalledWith({
        projectId,
        promptId,
        versionIds: [draftVersionId],
        generatedOptimizationIds: ['77774000-0000-4000-8000-000000000001'],
        includePromptShell: true,
      });
      expect(impact.total).toBe(2);
      expect(impact.releaseLines[0]?.name).toBe('production line');
      expect(impact.experiments[0]?.name).toBe('baseline');
    });
  });
});
