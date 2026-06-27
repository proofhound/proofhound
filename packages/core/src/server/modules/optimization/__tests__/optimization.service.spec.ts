import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { CreateOptimizationDto } from '@proofhound/shared';
import { ExperimentRepository, type ExperimentRow } from '../../experiment/experiment.repository';
import { ExperimentService } from '../../experiment/experiment.service';
import { PromptRepository } from '../../prompt/prompt.repository';
import { RunResultService } from '../../run-result/run-result.service';
import { OptimizationLauncher } from '../optimization.launcher';
import {
  OptimizationRepository,
  type OptimizationProjectAccessRow,
  type OptimizationRoundStepRow,
  type OptimizationRow,
} from '../optimization.repository';
import { OptimizationService } from '../optimization.service';
import { AccessControlService } from '../../../common/contracts/access-control.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import { WorkflowAuthorizationHook } from '../../../common/contracts/workflow-authorization.hook';
import { vi, type Mocked } from 'vitest';

const actor = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'alice@example.com',
  isSuperAdmin: false,
  isActive: true,
};
const projectAccess = (_role: string | null = null): OptimizationProjectAccessRow => ({
  id: '77777777-7777-4777-8777-777777777777',
});

const baseRow = (overrides: Partial<OptimizationRow> = {}): OptimizationRow => ({
  id: 'a1111111-1111-4111-8111-111111111111',
  projectId: '77777777-7777-4777-8777-777777777777',
  name: 'iter-risk-2026-0518-a',
  description: 'lift high-class recall above 0.85',
  optimizationHint: null,
  strategy: 'error_pattern_analysis',
  strategyConfig: {},
  startingMode: 'from_experiment',
  sourceExperimentId: 'b1111111-1111-4111-8111-111111111111',
  sourceExperimentName: 'exp-2026-0512-temp03',
  sourceExperimentMetrics: null,
  sourceExperimentPromptVersionId: 'v1111111-1111-4111-8111-111111111111',
  sourceExperimentPromptVersionNumber: 3,
  sourceExperimentStatus: 'success',
  sourceExperimentFailureReason: null,
  sourceExperimentStartedAt: new Date('2026-05-12T10:00:00Z'),
  sourceExperimentFinishedAt: new Date('2026-05-12T12:00:00Z'),
  sourceExperimentTotalSamples: 2480,
  sourceExperimentProcessedSamples: 2480,
  sourceExperimentFailedSamples: 0,
  promptId: null,
  promptName: null,
  baseVersionId: null,
  baseVersionNumber: null,
  datasetId: 'c1111111-1111-4111-8111-111111111111',
  datasetName: 'risk-eval-v3',
  datasetSamples: 2480,
  experimentModelId: 'd1111111-1111-4111-8111-111111111111',
  experimentModelName: 'claude-sonnet-4-6',
  analysisModelId: 'd2222222-2222-4222-8222-222222222222',
  analysisModelName: 'claude-opus-4-7',
  status: 'running',
  objectiveStatus: 'pending',
  controlState: null,
  dbosWorkflowId: null,
  goals: [{ metric: 'accuracy', comparator: 'gte', target: 0.82, scope: 'overall' }],
  fieldWhitelist: null,
  runConfig: { temperature: 0.3, concurrency: 8 },
  maxRounds: 10,
  stopAfterNoImprovementRounds: 2,
  currentRound: 0,
  bestVersionId: null,
  bestVersionNumber: null,
  bestMetrics: null,
  summary: null,
  analysisFailureReason: null,
  createdBy: actor.sub,
  createdByDisplayName: 'Alice',
  createdByUsername: 'alice',
  startedAt: null,
  finishedAt: null,
  createdAt: new Date('2026-05-18T07:55:00Z'),
  updatedAt: new Date('2026-05-18T08:08:00Z'),
  deletedAt: null,
  ...overrides,
  promptLanguage: overrides.promptLanguage ?? 'zh-CN',
});

const buildRoundStepRow = (overrides: Partial<OptimizationRoundStepRow> = {}): OptimizationRoundStepRow => ({
  optimizationId: 'a1111111-1111-4111-8111-111111111111',
  roundIndex: 1,
  step: 'error_analysis',
  status: 'running',
  errorClass: null,
  errorMessage: null,
  runResultId: null,
  experimentId: null,
  startedAt: new Date('2026-05-18T10:00:00Z'),
  finishedAt: null,
  attempt: 0,
  dbosWorkflowId: 'wf-1',
  createdAt: new Date('2026-05-18T10:00:00Z'),
  updatedAt: new Date('2026-05-18T10:00:00Z'),
  ...overrides,
});

const createInput: CreateOptimizationDto = {
  name: 'iter-risk-2026-0518-a',
  description: 'lift high-class recall above 0.85',
  strategy: 'error_pattern_analysis',
  startingMode: 'from_experiment',
  sourceExperimentId: 'b1111111-1111-4111-8111-111111111111',
  promptId: null,
  baseVersionId: null,
  datasetId: 'c1111111-1111-4111-8111-111111111111',
  experimentModelId: 'd1111111-1111-4111-8111-111111111111',
  analysisModelId: 'd2222222-2222-4222-8222-222222222222',
  goals: [{ metric: 'accuracy', comparator: 'gte', target: 0.82, scope: 'overall' }],
  fieldWhitelist: null,
  runConfig: { temperature: 0.3, concurrency: 8 },
  loopLimits: { maxRounds: 10, stopAfterNoImprovementRounds: 2 },
};

function makeRepo(): Mocked<OptimizationRepository> {
  return {
    findProjectAccess: vi.fn(),
    listOptimizations: vi.fn(),
    findOptimizationById: vi.fn(),
    findOptimizationByProjectAndName: vi.fn().mockResolvedValue(null),
    insertOptimization: vi.fn(),
    updateOptimization: vi.fn(),
    hardDeleteOptimization: vi.fn(),
    listRoundExperimentsForOptimization: vi.fn().mockResolvedValue([]),
    listOptimizationLlmRunResults: vi.fn().mockResolvedValue([]),
    listRoundStepsForOptimization: vi.fn().mockResolvedValue([]),
    upsertRoundStep: vi.fn().mockResolvedValue(undefined),
    loadPromptVersionsByIds: vi.fn().mockResolvedValue(new Map()),
    findActiveVersionIdForPrompt: vi.fn().mockResolvedValue(null),
    findPromptVersionLanguage: vi.fn().mockResolvedValue('zh-CN'),
    findUsablePromptVersion: vi.fn().mockResolvedValue({
      id: 'v1111111-1111-4111-8111-111111111111',
      promptId: 'p1111111-1111-4111-8111-111111111111',
      promptStatus: 'active',
      promptDeletedAt: null,
    }),
    findActiveChildExperiment: vi.fn().mockResolvedValue(null),
    findDatasetForOptimization: vi.fn().mockResolvedValue({
      id: 'c1111111-1111-4111-8111-111111111111',
      name: 'baseline-dataset',
    }),
    updateBaseVersionId: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<OptimizationRepository>;
}

function makeLauncher(): Mocked<OptimizationLauncher> {
  return {
    launch: vi.fn().mockResolvedValue('optimization:test:start:0'),
    resume: vi.fn().mockResolvedValue('optimization:test:resume:0'),
    retry: vi.fn().mockResolvedValue('optimization:test:retry:0'),
    startWithWorkflowId: vi.fn().mockResolvedValue('optimization:test:start:0'),
  } as unknown as Mocked<OptimizationLauncher>;
}

function makeExperimentRepo(): Mocked<ExperimentRepository> {
  return {
    findExperimentById: vi.fn(),
  } as unknown as Mocked<ExperimentRepository>;
}

function makeExperimentService(): Mocked<ExperimentService> {
  return {
    controlExperiment: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<ExperimentService>;
}

// By default, let RunResultService return an "empty aggregate" — OptimizationService.withLiveRoundMetrics
// keeps the round snapshot when the aggregate is empty, so existing cases (running rounds that rely on fixture metrics/processedSamples) stay unchanged.
// Cases that test the live aggregate override semantics override the mock return value in their own setup.
function makeRunResultService(): Mocked<RunResultService> {
  return {
    aggregateExperiment: vi.fn().mockResolvedValue([]),
    aggregateExperimentLatency: vi.fn().mockResolvedValue({ averageMs: null, p50Ms: null, p95Ms: null }),
  } as unknown as Mocked<RunResultService>;
}

function makePromptRepo(): Mocked<PromptRepository> {
  return {
    createPlaceholderPromptForOptimization: vi.fn(),
  } as unknown as Mocked<PromptRepository>;
}

const sourceExperimentRow: ExperimentRow = {
  id: 'b1111111-1111-4111-8111-111111111111',
  projectId: '77777777-7777-4777-8777-777777777777',
  name: 'exp-2026-0512-temp03',
  optimizationId: null,
  roundIndex: null,
  promptId: 'p1111111-1111-4111-8111-111111111111',
  promptVersionId: 'v1111111-1111-4111-8111-111111111111',
  promptName: 'sentiment-prompt',
  promptVersionNumber: 3,
  promptVariables: null,
  promptOutputSchema: null,
  datasetId: 'c1111111-1111-4111-8111-111111111111',
  datasetName: 'risk-eval-v3',
  datasetSamples: 2480,
  datasetHasImages: false,
  datasetFieldSchema: null,
  modelId: 'd1111111-1111-4111-8111-111111111111',
  modelName: 'claude-sonnet-4-6',
  providerModelId: 'claude-sonnet-4-6',
  status: 'success',
  controlState: null,
  totalSamples: 2480,
  processedSamples: 2480,
  failedSamples: 0,
  metrics: { accuracy: 0.81 },
  runConfig: {},
  dbosWorkflowId: null,
  failureKind: null,
  failureReason: null,
  createdBy: actor.sub,
  createdByDisplayName: 'Alice',
  createdByUsername: 'alice',
  startedAt: new Date('2026-05-12T10:00:00Z'),
  finishedAt: new Date('2026-05-12T12:00:00Z'),
  createdAt: new Date('2026-05-12T10:00:00Z'),
  updatedAt: new Date('2026-05-12T12:00:00Z'),
  deletedAt: null,
};

describe('OptimizationService', () => {
  let service: OptimizationService;
  let repo: Mocked<OptimizationRepository>;
  let launcher: Mocked<OptimizationLauncher>;
  let experimentRepo: Mocked<ExperimentRepository>;
  let experimentService: Mocked<ExperimentService>;
  let runResults: Mocked<RunResultService>;
  let promptRepo: Mocked<PromptRepository>;
  let workflowAuth: Mocked<WorkflowAuthorizationHook>;

  beforeEach(async () => {
    repo = makeRepo();
    launcher = makeLauncher();
    experimentRepo = makeExperimentRepo();
    experimentService = makeExperimentService();
    runResults = makeRunResultService();
    promptRepo = makePromptRepo();
    workflowAuth = {
      assertCanStart: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<WorkflowAuthorizationHook>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OptimizationRepository, useValue: repo },
        { provide: OptimizationLauncher, useValue: launcher },
        { provide: ExperimentRepository, useValue: experimentRepo },
        { provide: ExperimentService, useValue: experimentService },
        { provide: RunResultService, useValue: runResults },
        { provide: PromptRepository, useValue: promptRepo },
        { provide: AccessControlService, useClass: LocalAccessControlService },
        { provide: WorkflowAuthorizationHook, useValue: workflowAuth },
        OptimizationService,
      ],
    }).compile();

    service = module.get(OptimizationService);
  });

  describe('listOptimizations', () => {
    it('joins labels, sorts by updated desc, and supports search/status filters', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.listOptimizations.mockResolvedValue([
        baseRow({ id: 'a1111111-1111-4111-8111-111111111111', status: 'running', name: 'iter-risk-a' }),
        baseRow({
          id: 'a2222222-2222-4222-8222-222222222222',
          status: 'success',
          name: 'iter-fraud-b',
          bestMetrics: { accuracy: 0.91 },
          updatedAt: new Date('2026-05-18T09:00:00Z'),
        }),
      ]);

      const result = await service.listOptimizations(projectAccess().id, actor);

      expect(result.total).toBe(2);
      expect(result.data[0]!.id).toBe('a2222222-2222-4222-8222-222222222222');
      expect(result.data[0]!.experimentModelName).toBe('claude-sonnet-4-6');
      expect(result.data[0]!.analysisModelName).toBe('claude-opus-4-7');

      const filtered = await service.listOptimizations(projectAccess().id, actor, { status: 'success' });
      expect(filtered.data).toHaveLength(1);
      expect(filtered.data[0]!.status).toBe('success');

      const searched = await service.listOptimizations(projectAccess().id, actor, { search: 'fraud' });
      expect(searched.data).toHaveLength(1);
      expect(searched.data[0]!.name).toContain('fraud');
    });

    it('sorts by best metric', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.listOptimizations.mockResolvedValue([
        baseRow({ id: 'a1111111-1111-4111-8111-111111111111', bestMetrics: { accuracy: 0.7 } }),
        baseRow({ id: 'a2222222-2222-4222-8222-222222222222', bestMetrics: { accuracy: 0.9 } }),
      ]);

      const result = await service.listOptimizations(projectAccess().id, actor, { sort: 'bestMetric' });

      expect(result.data[0]!.id).toBe('a2222222-2222-4222-8222-222222222222');
    });

    it('derives live currentRound and updatedAt from round_steps before the main row catches up', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.listOptimizations.mockResolvedValue([
        baseRow({
          id: 'a1111111-1111-4111-8111-111111111111',
          status: 'running',
          name: 'iter-live',
          currentRound: 4,
          updatedAt: new Date('2026-05-18T08:00:00Z'),
        }),
        baseRow({
          id: 'a2222222-2222-4222-8222-222222222222',
          status: 'running',
          name: 'iter-stale',
          currentRound: 1,
          updatedAt: new Date('2026-05-18T08:30:00Z'),
        }),
      ]);
      repo.listRoundStepsForOptimization.mockImplementation(async (id) =>
        id === 'a1111111-1111-4111-8111-111111111111'
          ? [
              buildRoundStepRow({
                optimizationId: id,
                roundIndex: 5,
                step: 'generate_prompt',
                status: 'running',
                updatedAt: new Date('2026-05-18T11:00:00Z'),
              }),
            ]
          : [],
      );

      const result = await service.listOptimizations(projectAccess().id, actor, { sort: 'updated' });

      expect(result.data[0]!.id).toBe('a1111111-1111-4111-8111-111111111111');
      expect(result.data[0]!.currentRound).toBe(5);
      expect(result.data[0]!.updatedAt).toBe('2026-05-18T11:00:00.000Z');
    });

    it('does not count a from_experiment baseline round in live progress', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.listOptimizations.mockResolvedValue([
        baseRow({
          currentRound: 1,
          updatedAt: new Date('2026-05-18T08:00:00Z'),
        }),
      ]);
      repo.listRoundExperimentsForOptimization.mockResolvedValue([
        {
          experimentId: 'b1111111-1111-4111-8111-111111111111',
          experimentName: 'source-baseline',
          roundIndex: 1,
          isBaseline: true,
          promptVersionId: 'v1111111-1111-4111-8111-111111111111',
          promptVersionNumber: 3,
          parentVersionId: null,
          status: 'success',
          metrics: { accuracy: 0.81 },
          failureReason: null,
          startedAt: new Date('2026-05-18T08:10:00Z'),
          finishedAt: new Date('2026-05-18T08:20:00Z'),
          totalSamples: 100,
          processedSamples: 100,
          failedSamples: 0,
          updatedAt: new Date('2026-05-18T08:30:00Z'),
        },
      ]);
      repo.listRoundStepsForOptimization.mockResolvedValue([
        buildRoundStepRow({
          roundIndex: 0,
          step: 'experiment',
          status: 'success',
          startedAt: new Date('2026-05-18T08:21:00Z'),
          finishedAt: new Date('2026-05-18T08:24:00Z'),
          createdAt: new Date('2026-05-18T08:21:00Z'),
          updatedAt: new Date('2026-05-18T08:25:00Z'),
        }),
      ]);

      const result = await service.listOptimizations(projectAccess().id, actor);

      expect(result.data[0]!.currentRound).toBe(0);
      expect(result.data[0]!.updatedAt).toBe('2026-05-18T08:30:00.000Z');
    });

    it('normalizes legacy goal JSON from old dev seed rows', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.listOptimizations.mockResolvedValue([
        baseRow({ goals: { primary_metric: 'accuracy', target: 0.95 } }),
        baseRow({
          id: 'a2222222-2222-4222-8222-222222222222',
          goals: [{ metric: 'f1', op: 'gte', value: 0.8, scope: 'overall' }],
        }),
      ]);

      const result = await service.listOptimizations(projectAccess().id, actor, { sort: 'updated' });

      expect(result.data[0]!.goals).toEqual([
        { metric: 'accuracy', comparator: 'gte', target: 0.95, scope: 'overall' },
      ]);
      expect(result.data[1]!.goals).toEqual([{ metric: 'f1', comparator: 'gte', target: 0.8, scope: 'overall' }]);
    });

    it('throws when project not accessible', async () => {
      repo.findProjectAccess.mockResolvedValue(null);
      await expect(service.listOptimizations('00000000-0000-4000-8000-000000000000', actor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('includes baseline as first trend point + trendHasBaseline=true when sourceExperimentMetrics has primary metric', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.listOptimizations.mockResolvedValue([baseRow({ sourceExperimentMetrics: { accuracy: 0.81 } })]);
      repo.listRoundExperimentsForOptimization.mockResolvedValue([
        {
          experimentId: 'e1',
          experimentName: 'r1',
          roundIndex: 1,
          promptVersionId: 'pv1',
          promptVersionNumber: 2,
          parentVersionId: null,
          status: 'success',
          metrics: { accuracy: 0.85 },
          failureReason: null,
          startedAt: null,
          finishedAt: null,
          totalSamples: 100,
          processedSamples: 100,
          failedSamples: 0,
        },
      ]);

      const result = await service.listOptimizations(projectAccess().id, actor);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.trend).toEqual([0.81, 0.85]);
      expect(result.data[0]!.trendHasBaseline).toBe(true);
    });

    it('falls back to trendHasBaseline=false when sourceExperimentMetrics missing', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.listOptimizations.mockResolvedValue([baseRow({ sourceExperimentMetrics: null })]);
      repo.listRoundExperimentsForOptimization.mockResolvedValue([
        {
          experimentId: 'e1',
          experimentName: 'r1',
          roundIndex: 1,
          promptVersionId: 'pv1',
          promptVersionNumber: 2,
          parentVersionId: null,
          status: 'success',
          metrics: { accuracy: 0.85 },
          failureReason: null,
          startedAt: null,
          finishedAt: null,
          totalSamples: 100,
          processedSamples: 100,
          failedSamples: 0,
        },
      ]);

      const result = await service.listOptimizations(projectAccess().id, actor);
      expect(result.data[0]!.trend).toEqual([0.85]);
      expect(result.data[0]!.trendHasBaseline).toBe(false);
    });
  });

  describe('getOptimization', () => {
    it('returns mapped detail DTO when row exists', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(baseRow());

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);

      expect(result.id).toBe(baseRow().id);
      expect(result.experimentModelName).toBe('claude-sonnet-4-6');
      expect(result.ownerHandle).toBe('@alice');
      expect(result.goalScope).toEqual({ kind: 'overall' });
      expect(result.goalsLines).toHaveLength(1);
      expect(result.goalsLines[0]?.targetText).toBe('≥ 0.82');
      expect(result.experimentConfig).toMatchObject({
        datasetName: 'risk-eval-v3',
        modelName: 'claude-sonnet-4-6',
        baselineExperiment: 'exp-2026-0512-temp03',
        temperature: 0.3,
        concurrency: 8,
      });
      expect(result.iterationConfig).toMatchObject({
        analysisModel: 'claude-opus-4-7',
        strategy: 'error_pattern_analysis',
        maxRounds: 10,
      });
      // Aggregate fields default to empty until the workflow lands.
      expect(result.trend).toEqual([]);
      expect(result.rounds).toEqual([]);
      expect(result.bestVersion).toBeNull();
      expect(result.controlStrip).toBeNull();
      expect(result.goalProgress).toEqual([]);
    });

    it('populates baseline.metrics from sourceExperimentMetrics', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(
        baseRow({ sourceExperimentMetrics: { accuracy: 0.81, recall: 0.7, inputTokens: 1200 } }),
      );
      repo.loadPromptVersionsByIds.mockResolvedValue(
        new Map([
          [
            'v1111111-1111-4111-8111-111111111111',
            {
              body: 'Classify {{input_text}} risk.',
              versionNumber: 3,
              outputSchema: {
                fields: [{ key: 'risk_level', value: 'safe | risky', isJudgment: true }],
              },
            },
          ],
        ]),
      );

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      expect(result.baseline?.baselineExperiment).toBe('exp-2026-0512-temp03');
      const labels = (result.baseline?.metrics ?? []).map((m) => m.label).sort();
      expect(labels).toEqual(['accuracy', 'inputTokens', 'recall']);
      expect(result.baseline?.promptPreview).toContain('Classify {{input_text}} risk.');
      expect(result.baseline?.promptPreview).toContain('## 输出格式');
      expect(result.baseline?.experimentResult?.samplesDone).toBe(2480);
      expect(result.baseline?.experimentResult?.overallRow?.accuracy).toBe(0.81);
    });

    it('exposes prompt-start baseline experiment progress and prompt preview', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(
        baseRow({
          startingMode: 'from_prompt_version',
          sourceExperimentName: 'optimization:a1111111-1111-4111-8111-111111111111:baseline',
          sourceExperimentStatus: 'running',
          sourceExperimentMetrics: { accuracy: 0.72, precision: 0.7, recall: 0.68 },
          sourceExperimentProcessedSamples: 72,
          sourceExperimentTotalSamples: 100,
          baseVersionId: 'v1111111-1111-4111-8111-111111111111',
          baseVersionNumber: 3,
        }),
      );
      repo.loadPromptVersionsByIds.mockResolvedValue(
        new Map([
          [
            'v1111111-1111-4111-8111-111111111111',
            {
              body: 'Classify {{input_text}} risk before optimization.',
              versionNumber: 3,
              outputSchema: {
                fields: [{ key: 'risk_level', value: 'safe | risky', isJudgment: true }],
              },
            },
          ],
        ]),
      );

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      expect(result.baseline?.baselineExperiment).toBe('optimization:a1111111-1111-4111-8111-111111111111:baseline');
      expect(result.baseline?.promptPreview).toContain('Classify {{input_text}} risk before optimization.');
      expect(result.baseline?.experimentResult?.experimentStatus).toBe('running');
      expect(result.baseline?.experimentResult?.samplesDone).toBe(72);
      expect(result.baseline?.experimentResult?.overallRow?.accuracy).toBe(0.72);
    });

    it('uses baseline metrics as effective best for goal progress and best version before any optimized round wins', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(
        baseRow({
          promptId: 'p1111111-1111-4111-8111-111111111111',
          promptName: 'risk-judge',
          sourceExperimentMetrics: { accuracy: 0.84 },
          sourceExperimentPromptVersionId: 'v1111111-1111-4111-8111-111111111111',
          sourceExperimentPromptVersionNumber: 3,
        }),
      );

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);

      expect(result.goalProgress).toEqual([
        {
          label: 'Accuracy',
          targetText: '≥ 0.82',
          currentText: '0.840',
          achieved: 'hit',
          percent: 100,
        },
      ]);
      expect(result.bestRoundLabel).toBe('baseline');
      expect(result.bestVersion).toMatchObject({
        promptRef: 'risk-judge',
        promptVersion: 'v3',
        generatedAtRoundLabel: 'baseline',
        generatedAtRoundIndex: 0,
        experimentRef: 'exp-2026-0512-temp03',
        promptVersionId: 'v1111111-1111-4111-8111-111111111111',
        experimentId: 'b1111111-1111-4111-8111-111111111111',
      });
    });

    it('keeps an optimized persisted best when it beats the baseline candidate', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(
        baseRow({
          promptId: 'p1111111-1111-4111-8111-111111111111',
          promptName: 'risk-judge',
          sourceExperimentMetrics: { accuracy: 0.84 },
          bestVersionId: 'pv222222-2222-4222-8222-222222222222',
          bestVersionNumber: 4,
          bestMetrics: { accuracy: 0.88 },
        }),
      );
      repo.listRoundExperimentsForOptimization.mockResolvedValue([
        {
          experimentId: 'e2222222-2222-4222-8222-222222222222',
          experimentName: 'round-2',
          roundIndex: 2,
          promptVersionId: 'pv222222-2222-4222-8222-222222222222',
          promptVersionNumber: 4,
          parentVersionId: 'pv111111-1111-4111-8111-111111111111',
          status: 'success',
          metrics: { accuracy: 0.88 },
          failureReason: null,
          startedAt: new Date('2026-05-18T11:00:00Z'),
          finishedAt: new Date('2026-05-18T11:30:00Z'),
          totalSamples: 100,
          processedSamples: 100,
          failedSamples: 0,
        },
      ]);

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);

      expect(result.goalProgress[0]?.currentText).toBe('0.880');
      expect(result.bestRoundLabel).toBe('v4');
      expect(result.bestVersion).toMatchObject({
        promptRef: 'risk-judge',
        promptVersion: 'v4',
        generatedAtRoundLabel: 'v4',
        generatedAtRoundIndex: 2,
        experimentRef: 'round-2',
        promptVersionId: 'pv222222-2222-4222-8222-222222222222',
        experimentId: 'e2222222-2222-4222-8222-222222222222',
      });
    });

    it('uses latest round metrics for goal progress when no best candidate exists', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(
        baseRow({
          startingMode: 'from_prompt_version',
          sourceExperimentMetrics: null,
          promptId: 'p1111111-1111-4111-8111-111111111111',
          promptName: 'risk-judge',
          baseVersionId: 'pv111111-1111-4111-8111-111111111111',
          baseVersionNumber: 3,
          goals: [{ metric: 'precision', comparator: 'gte', target: 0.95, scope: 'good' }],
          bestVersionId: null,
          bestVersionNumber: null,
          bestMetrics: null,
        }),
      );
      repo.listRoundExperimentsForOptimization.mockResolvedValue([
        {
          experimentId: 'e2222222-2222-4222-8222-222222222222',
          experimentName: 'round-2',
          roundIndex: 2,
          promptVersionId: 'pv222222-2222-4222-8222-222222222222',
          promptVersionNumber: 4,
          parentVersionId: 'pv111111-1111-4111-8111-111111111111',
          status: 'success',
          metrics: {
            precision: 0.97,
            perClass: [{ label: 'good', precision: 0.91, recall: 0.84 }],
          },
          failureReason: null,
          startedAt: new Date('2026-05-18T11:00:00Z'),
          finishedAt: new Date('2026-05-18T11:30:00Z'),
          totalSamples: 100,
          processedSamples: 100,
          failedSamples: 0,
        },
      ]);

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);

      expect(result.bestVersion).toBeNull();
      expect(result.goalProgress).toMatchObject([
        {
          label: 'good Precision',
          currentText: '0.910',
          targetText: '≥ 0.95',
          achieved: 'miss',
        },
      ]);
    });

    it('uses class-scoped best metrics for goal progress', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(
        baseRow({
          promptId: 'p1111111-1111-4111-8111-111111111111',
          promptName: 'risk-judge',
          goals: [{ metric: 'precision', comparator: 'gte', target: 0.8, scope: 'good' }],
          bestVersionId: 'pv222222-2222-4222-8222-222222222222',
          bestVersionNumber: 4,
          bestMetrics: {
            precision: 0.5,
            perClass: [
              { label: 'bad', precision: 0.3 },
              { label: 'good', precision: 0.875 },
            ],
          },
        }),
      );
      repo.listRoundExperimentsForOptimization.mockResolvedValue([
        {
          experimentId: 'e2222222-2222-4222-8222-222222222222',
          experimentName: 'round-2',
          roundIndex: 2,
          promptVersionId: 'pv222222-2222-4222-8222-222222222222',
          promptVersionNumber: 4,
          parentVersionId: 'pv111111-1111-4111-8111-111111111111',
          status: 'success',
          metrics: {
            precision: 0.5,
            perClass: [
              { label: 'bad', precision: 0.3 },
              { label: 'good', precision: 0.875 },
            ],
          },
          failureReason: null,
          startedAt: new Date('2026-05-18T11:00:00Z'),
          finishedAt: new Date('2026-05-18T11:30:00Z'),
          totalSamples: 100,
          processedSamples: 100,
          failedSamples: 0,
        },
      ]);

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);

      expect(result.goalProgress).toMatchObject([
        {
          label: 'good Precision',
          currentText: '0.875',
          achieved: 'hit',
        },
      ]);
    });

    it('produces trend series with baseline as the first point when sourceExperimentMetrics has the metric', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(baseRow({ sourceExperimentMetrics: { accuracy: 0.81 } }));
      repo.listRoundExperimentsForOptimization.mockResolvedValue([
        {
          experimentId: 'e1',
          experimentName: 'r1',
          roundIndex: 1,
          promptVersionId: 'pv1',
          promptVersionNumber: 2,
          parentVersionId: null,
          status: 'success',
          metrics: { accuracy: 0.85 },
          failureReason: null,
          startedAt: new Date('2026-05-18T10:00:00Z'),
          finishedAt: new Date('2026-05-18T10:30:00Z'),
          totalSamples: 100,
          processedSamples: 100,
          failedSamples: 0,
        },
        {
          experimentId: 'e2',
          experimentName: 'r2',
          roundIndex: 2,
          promptVersionId: 'pv2',
          promptVersionNumber: 3,
          parentVersionId: 'pv1',
          status: 'success',
          metrics: { accuracy: 0.88 },
          failureReason: null,
          startedAt: new Date('2026-05-18T11:00:00Z'),
          finishedAt: new Date('2026-05-18T11:30:00Z'),
          totalSamples: 100,
          processedSamples: 100,
          failedSamples: 0,
        },
      ]);

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      const accuracy = result.trend.find((s) => s.key === 'accuracy');
      expect(accuracy).toBeDefined();
      expect(accuracy?.hasBaseline).toBe(true);
      expect(accuracy?.values).toEqual([0.81, 0.85, 0.88]);
      // bestRoundIndex still refers to the best index within the round set (excluding baseline): round 2 (idx=1) is the highest
      expect(accuracy?.bestRoundIndex).toBe(1);
    });

    it('emits trend series with only baseline point when no rounds yet', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(baseRow({ sourceExperimentMetrics: { accuracy: 0.81 } }));
      repo.listRoundExperimentsForOptimization.mockResolvedValue([]);

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      const accuracy = result.trend.find((s) => s.key === 'accuracy');
      expect(accuracy).toBeDefined();
      expect(accuracy?.hasBaseline).toBe(true);
      expect(accuracy?.values).toEqual([0.81]);
      expect(accuracy?.bestRoundIndex).toBeUndefined();
    });

    it('falls back to hasBaseline=false trend when no sourceExperimentMetrics', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(baseRow({ sourceExperimentMetrics: null }));
      repo.listRoundExperimentsForOptimization.mockResolvedValue([
        {
          experimentId: 'e1',
          experimentName: 'r1',
          roundIndex: 1,
          promptVersionId: 'pv1',
          promptVersionNumber: 2,
          parentVersionId: null,
          status: 'success',
          metrics: { accuracy: 0.85 },
          failureReason: null,
          startedAt: new Date('2026-05-18T10:00:00Z'),
          finishedAt: new Date('2026-05-18T10:30:00Z'),
          totalSamples: 100,
          processedSamples: 100,
          failedSamples: 0,
        },
      ]);

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      const accuracy = result.trend.find((s) => s.key === 'accuracy');
      expect(accuracy?.hasBaseline).toBe(false);
      expect(accuracy?.values).toEqual([0.85]);
    });

    it('derives elapsedMs from startedAt → finishedAt range', async () => {
      const startedAt = new Date('2026-05-18T10:00:00.000Z');
      const finishedAt = new Date('2026-05-18T12:30:00.000Z');
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(baseRow({ startedAt, finishedAt, status: 'success' }));

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      expect(result.elapsedMs).toBe(2.5 * 60 * 60 * 1000);
    });

    it('returns null elapsedMs when startedAt is missing', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(baseRow({ startedAt: null, finishedAt: null }));

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      expect(result.elapsedMs).toBeNull();
    });

    it('derives class goalScope from non-overall scopes', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(
        baseRow({
          goals: [
            { metric: 'recall', comparator: 'gte', target: 0.85, scope: 'high' },
            { metric: 'recall', comparator: 'gte', target: 0.75, scope: 'mid' },
          ],
        }),
      );

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      expect(result.goalScope).toEqual({ kind: 'class', classes: ['high', 'mid'] });
      expect(result.goalsLines.map((line) => line.tone)).toEqual(['class', 'class']);
    });

    it('throws NotFound when row missing', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(null);
      await expect(service.getOptimization(projectAccess().id, 'missing-id', actor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('maps DB summary + analysisFailureReason into DTO (failure case)', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(
        baseRow({
          status: 'failed',
          summary: {
            kind: 'failed',
            reason: 'analysis_failed: upstream 502 from provider',
            finalizedAt: '2026-05-18T10:00:00.000Z',
          },
          analysisFailureReason: 'analysis_failed: upstream 502 from provider',
        }),
      );

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      expect(result.status).toBe('failed');
      expect(result.summary).toMatchObject({
        kind: 'failed',
        reason: 'analysis_failed: upstream 502 from provider',
      });
      expect(result.analysisFailureReason).toBe('analysis_failed: upstream 502 from provider');
    });

    it('truncates overly long summary.reason to 500 chars + ellipsis to avoid leaking upstream payloads', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      const longReason = `analysis_failed: ${'x'.repeat(900)}`;
      repo.findOptimizationById.mockResolvedValue(
        baseRow({
          status: 'failed',
          summary: { kind: 'failed', reason: longReason, finalizedAt: '2026-05-18T10:00:00.000Z' },
        }),
      );

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      expect(result.summary?.reason.length).toBe(501); // 500 + …
      expect(result.summary?.reason.endsWith('…')).toBe(true);
    });

    it('returns mock timeline when runConfig.devMockTimeline is well-formed', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      const mockTimeline = {
        trend: [
          {
            key: 'accuracy' as const,
            labelKey: 'optimizations.detail.trend.accuracy',
            values: [0.92, 0.94],
            target: 0.95,
            bestRoundIndex: 1,
          },
        ],
        trendBaselineRef: 0.92,
        bestRoundLabel: 'v2',
        controlStrip: null,
        rounds: [
          {
            index: 1,
            status: 'success' as const,
            isBest: true,
            kindLabel: 'analysis → propose v2',
            metrics: [{ label: 'acc', value: 0.94 }],
          },
        ],
        baselineMetrics: [{ label: 'acc', value: 0.92 }],
        goalProgress: [
          {
            label: 'Accuracy',
            targetText: '≥ 0.95',
            currentText: '0.94',
            achieved: 'critical' as const,
            percent: 99,
          },
        ],
        bestVersion: {
          promptRef: 'ChnSentiCorp@v2',
          promptVersion: 'v2',
          generatedAtRoundLabel: 'v2',
          generatedAtRoundIndex: 1,
          metrics: [{ label: 'acc', value: 0.94, tone: 'ok' as const }],
          experimentRef: 'ChnSentiCorp 优化 r1',
        },
      };
      repo.findOptimizationById.mockResolvedValue(
        baseRow({ runConfig: { temperature: 0.3, devMockTimeline: mockTimeline } }),
      );

      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);

      expect(result.trend).toHaveLength(1);
      expect(result.trend[0]?.values).toEqual([0.92, 0.94]);
      expect(result.trendBaselineRef).toBe(0.92);
      expect(result.bestRoundLabel).toBe('v2');
      expect(result.rounds).toHaveLength(1);
      expect(result.rounds[0]?.kindLabel).toBe('analysis → propose v2');
      expect(result.bestVersion?.promptRef).toBe('ChnSentiCorp@v2');
      expect(result.goalProgress).toHaveLength(1);
      // baselineMetrics should be merged into baseline.metrics
      expect(result.baseline?.metrics).toEqual([{ label: 'acc', value: 0.92 }]);
    });

    it('falls back to empty aggregates when runConfig.devMockTimeline is malformed', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(
        baseRow({ runConfig: { temperature: 0.3, devMockTimeline: { trend: 'not-an-array' } } }),
      );

      // Should NOT throw — the service silently falls back to an empty state when safeParse fails
      const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
      expect(result.trend).toEqual([]);
      expect(result.rounds).toEqual([]);
      expect(result.bestVersion).toBeNull();
    });

    describe('deriveRoundDetails real aggregation', () => {
      const buildExperimentRow = (overrides: Record<string, unknown> = {}) => ({
        experimentId: 'e1111111-1111-4111-8111-111111111111',
        experimentName: 'exp-round-1',
        roundIndex: 1,
        promptVersionId: 'pv222222-2222-4222-8222-222222222222',
        promptVersionNumber: 2,
        parentVersionId: 'pv111111-1111-4111-8111-111111111111',
        status: 'running',
        metrics: {
          accuracy: 0.7,
          inputTokens: 1200,
          outputTokens: 800,
          costEstimate: 0.0123,
          perClass: [
            { label: 'positive', precision: 0.75, recall: 0.72 },
            { label: 'negative', precision: 0.68, recall: 0.69 },
          ],
        },
        failureReason: null,
        startedAt: new Date('2026-05-18T10:00:00Z'),
        finishedAt: null,
        totalSamples: 100,
        processedSamples: 60,
        failedSamples: 0,
        ...overrides,
      });

      const buildAnalysisLlmRow = (overrides: Record<string, unknown> = {}) => ({
        runResultId: 'rr111111-1111-4111-8111-111111111111',
        roundIndex: 1,
        source: 'optimization_analysis',
        promptVersionId: 'pv222222-2222-4222-8222-222222222222',
        parsedOutput: {
          summary: 'model mainly confuses positive vs negative on short reviews',
          errorPatterns: [
            { label: 'short reviews', count: 18, reason: 'lacks polarity cue' },
            { label: 'sarcasm', count: 6, reason: 'literal interpretation' },
          ],
          suggestedChanges: [
            {
              section: 'instructions',
              change: 'Add explicit guidance for short reviews',
              rationale: 'most errors cluster on <10 token inputs',
              priority: 'high',
            },
            {
              section: 'output_schema',
              change: 'Require justification field',
              rationale: 'forces the model to articulate polarity cues',
              priority: 'medium',
            },
          ],
        },
        rawResponse: null,
        errorMessage: null,
        status: 'success',
        inputTokens: 500,
        outputTokens: 400,
        costEstimate: '0.0040',
        createdAt: new Date('2026-05-18T10:01:00Z'),
        ...overrides,
      });

      const buildGenerateLlmRow = (overrides: Record<string, unknown> = {}) => ({
        runResultId: 'rr222222-2222-4222-8222-222222222222',
        roundIndex: 1,
        source: 'optimization_generate',
        promptVersionId: 'pv111111-1111-4111-8111-111111111111',
        parsedOutput: {
          newPromptBody: 'Classify sentiment.\nFor short reviews, examine intensifiers carefully.',
          changeSummary: 'add short-review guidance',
        },
        rawResponse: null,
        errorMessage: null,
        status: 'success',
        inputTokens: 600,
        outputTokens: 500,
        costEstimate: '0.0050',
        createdAt: new Date('2026-05-18T10:02:00Z'),
        ...overrides,
      });

      it('produces errorPatterns and improvementSuggestions from analysis parsedOutput', async () => {
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow());
        repo.listRoundExperimentsForOptimization.mockResolvedValue([buildExperimentRow()]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([buildAnalysisLlmRow()]);
        repo.loadPromptVersionsByIds.mockResolvedValue(new Map());

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        expect(result.rounds).toHaveLength(1);
        const round = result.rounds[0]!;
        expect(round.errorPatterns).toEqual([
          { percent: 75, title: 'short reviews', detail: 'lacks polarity cue', count: { hit: 18, total: 24 } },
          { percent: 25, title: 'sarcasm', detail: 'literal interpretation', count: { hit: 6, total: 24 } },
        ]);
        expect(round.improvementSuggestions).toEqual([
          {
            section: 'instructions',
            title: 'Add explicit guidance for short reviews',
            detail: 'most errors cluster on <10 token inputs',
            priority: 'high',
          },
          {
            section: 'output_schema',
            title: 'Require justification field',
            detail: 'forces the model to articulate polarity cues',
            priority: 'medium',
          },
        ]);
      });

      it('produces promptDiff with toText from generate LLM and fromText from previous round body', async () => {
        const baseVersionId = 'pv000000-0000-4000-8000-000000000000';
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow({ baseVersionId }));
        repo.listRoundExperimentsForOptimization.mockResolvedValue([
          buildExperimentRow({ parentVersionId: baseVersionId }),
        ]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([
          buildAnalysisLlmRow(),
          buildGenerateLlmRow({ promptVersionId: baseVersionId }),
        ]);
        const bodies = new Map<string, { body: string | null; versionNumber: number; outputSchema: unknown }>();
        bodies.set(baseVersionId, {
          body: 'Classify sentiment.',
          versionNumber: 1,
          outputSchema: null,
        });
        repo.loadPromptVersionsByIds.mockResolvedValue(bodies);

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        const round = result.rounds[0]!;
        expect(round.promptDiff).toBeDefined();
        expect(round.promptDiff?.fromText).toBe('Classify sentiment.');
        expect(round.promptDiff?.toText).toBe(
          'Classify sentiment.\nFor short reviews, examine intensifiers carefully.',
        );
        expect(round.promptDiff?.from).toBe('v1');
        expect(round.promptDiff?.to).toBe('v2');
        expect(round.promptDiff?.lines).toEqual([]);
      });

      it('uses the generated prompt parent as promptDiff base instead of the previous chronological round', async () => {
        const baseVersionId = 'pv000000-0000-4000-8000-000000000000';
        const parentVersionId = 'pv222222-2222-4222-8222-222222222222';
        const regressedVersionId = 'pv333333-3333-4333-8333-333333333333';
        const currentVersionId = 'pv444444-4444-4444-8444-444444444444';
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow({ baseVersionId }));
        repo.listRoundExperimentsForOptimization.mockResolvedValue([
          buildExperimentRow({
            experimentId: 'e1111111-1111-4111-8111-111111111111',
            roundIndex: 1,
            promptVersionId: parentVersionId,
            promptVersionNumber: 2,
            parentVersionId: baseVersionId,
            status: 'success',
          }),
          buildExperimentRow({
            experimentId: 'e2222222-2222-4222-8222-222222222222',
            roundIndex: 2,
            promptVersionId: regressedVersionId,
            promptVersionNumber: 3,
            parentVersionId,
            status: 'success',
          }),
          buildExperimentRow({
            experimentId: 'e3333333-3333-4333-8333-333333333333',
            roundIndex: 3,
            promptVersionId: currentVersionId,
            promptVersionNumber: 4,
            parentVersionId,
            status: 'success',
          }),
        ]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([
          buildGenerateLlmRow({
            roundIndex: 3,
            promptVersionId: parentVersionId,
            parsedOutput: {
              newPromptBody: 'Parent prompt.\nAdd a safer clarification.',
            },
          }),
        ]);
        const bodies = new Map<string, { body: string | null; versionNumber: number; outputSchema: unknown }>();
        bodies.set(parentVersionId, {
          body: 'Parent prompt.',
          versionNumber: 2,
          outputSchema: null,
        });
        bodies.set(regressedVersionId, {
          body: 'Regressed prompt.',
          versionNumber: 3,
          outputSchema: null,
        });
        repo.loadPromptVersionsByIds.mockResolvedValue(bodies);

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        const round = result.rounds.find((r) => r.index === 3)!;
        expect(round.promptDiff?.fromText).toBe('Parent prompt.');
        expect(round.promptDiff?.fromText).not.toBe('Regressed prompt.');
        expect(round.promptDiff?.toText).toBe('Parent prompt.\nAdd a safer clarification.');
        expect(round.promptDiff?.from).toBe('v2');
        expect(round.promptDiff?.to).toBe('v4');
        expect(repo.loadPromptVersionsByIds).toHaveBeenCalledWith(
          expect.arrayContaining([baseVersionId, parentVersionId, regressedVersionId, currentVersionId]),
        );
      });

      it('renders prompt diff outputSchema as 「## 输出格式」 instruction (mirrors actual LLM dispatch)', async () => {
        // When outputSchema is a {fields:[...]} DTO shape, the diff view must match the composeFullPrompt result
        // "actually sent to the business LLM": it should render as the localized "## Output Format" section,
        // rather than presenting the raw {"fields":[{"key":"label",...,"isJudgment":true}]} as a ```json code block. The isJudgment metadata must not leak into the downstream prompt text.
        const baseVersionId = 'pv000000-0000-4000-8000-000000000000';
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow({ baseVersionId }));
        repo.listRoundExperimentsForOptimization.mockResolvedValue([
          buildExperimentRow({ parentVersionId: baseVersionId }),
        ]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([
          buildAnalysisLlmRow(),
          buildGenerateLlmRow({ promptVersionId: baseVersionId }),
        ]);
        const bodies = new Map<string, { body: string | null; versionNumber: number; outputSchema: unknown }>();
        bodies.set(baseVersionId, {
          body: 'Classify sentiment.',
          versionNumber: 1,
          outputSchema: {
            fields: [{ key: 'label', value: 'positive 或 negative', isJudgment: true }],
          },
        });
        repo.loadPromptVersionsByIds.mockResolvedValue(bodies);

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        const diff = result.rounds[0]!.promptDiff;
        expect(diff).toBeDefined();
        expect(diff?.toText).toContain('## 输出格式');
        expect(diff?.toText).toContain('"label": <string>');
        expect(diff?.toText).toContain('positive 或 negative');
        expect(diff?.toText).not.toContain('isJudgment');
        expect(diff?.toText).not.toContain('"fields":');
        expect(diff?.fromText).toContain('## 输出格式');
        expect(diff?.fromText).toContain('"label": <string>');
      });

      it('produces experimentResult with progress / metrics / class rows for the running round', async () => {
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow());
        repo.listRoundExperimentsForOptimization.mockResolvedValue([buildExperimentRow()]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([]);
        repo.loadPromptVersionsByIds.mockResolvedValue(new Map());

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        const exp = result.rounds[0]!.experimentResult;
        expect(exp).toBeDefined();
        expect(exp?.experimentRef).toBe('exp-round-1');
        expect(exp?.experimentStatus).toBe('running');
        expect(exp?.samplesDone).toBe(60);
        expect(exp?.samplesTotal).toBe(100);
        expect(exp?.correct).toBe(42); // 0.7 * 60
        expect(exp?.wrong).toBe(18);
        expect(exp?.tokenSummary).toContain('→');
        expect(exp?.costLabel).toBe('$0.0123');
        expect(exp?.classRows).toEqual([
          { label: 'positive', precision: 0.75, recall: 0.72, vsLabel: 'baseline', vsDelta: null, vsTone: 'neutral' },
          { label: 'negative', precision: 0.68, recall: 0.69, vsLabel: 'baseline', vsDelta: null, vsTone: 'neutral' },
        ]);
        // Overall row (overallRow): accuracy comes from metricsObj.accuracy (0.7); precision/recall are not provided in metrics → 0;
        // no sourceExperimentMetrics → vsDelta=null, vsTone=neutral, vsLabel='baseline'
        expect(exp?.overallRow).toEqual({
          accuracy: 0.7,
          precision: 0,
          recall: 0,
          vsLabel: 'baseline',
          vsDelta: null,
          vsTone: 'neutral',
        });
        // Per-round goal chip: goals=[{accuracy gte 0.82 overall}], current 0.7 < 0.82 → miss
        expect(result.rounds[0]!.goalChips).toEqual([
          {
            label: 'Accuracy',
            targetText: '≥ 0.82',
            currentText: '0.700',
            achieved: 'miss',
          },
        ]);
      });

      it('marks from_dataset_only round 0 as baseline and keeps experiment progress without analysis blocks', async () => {
        const baselineVersionId = 'pv000000-0000-4000-8000-000000000000';
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(
          baseRow({
            startingMode: 'from_dataset_only',
            sourceExperimentName: 'optimization:a1111111-1111-4111-8111-111111111111:baseline',
            sourceExperimentMetrics: { accuracy: 0.66 },
            promptId: 'p1111111-1111-4111-8111-111111111111',
            promptName: 'risk-judge',
            baseVersionId: baselineVersionId,
            baseVersionNumber: 1,
          }),
        );
        repo.listRoundExperimentsForOptimization.mockResolvedValue([
          buildExperimentRow({
            experimentName: 'optimization:a1111111-1111-4111-8111-111111111111:baseline',
            roundIndex: 0,
            isBaseline: true,
            promptVersionId: baselineVersionId,
            promptVersionNumber: 1,
            parentVersionId: null,
            metrics: { accuracy: 0.66 },
            processedSamples: 42,
            totalSamples: 100,
          }),
        ]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([
          buildGenerateLlmRow({
            roundIndex: 0,
            promptVersionId: baselineVersionId,
            parsedOutput: {
              newPromptBody: 'Classify SQL risk from {{query}}.',
              changeSummary: 'generate first prompt from dataset samples',
            },
          }),
        ]);
        repo.loadPromptVersionsByIds.mockResolvedValue(
          new Map([
            [
              baselineVersionId,
              {
                body: 'Classify SQL risk from {{query}}.',
                versionNumber: 1,
                outputSchema: {
                  fields: [
                    { key: 'risk_level', value: 'SQL 风险等级：safe / risky', isJudgment: true },
                    { key: 'reason', value: '简短说明判定依据' },
                  ],
                },
              },
            ],
          ]),
        );

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        expect(result.trend[0]?.hasBaseline).toBe(true);
        expect(result.trend[0]?.values).toEqual([0.66]);
        expect(result.rounds).toHaveLength(1);
        const round = result.rounds[0]!;
        expect(round.index).toBe(0);
        expect(round.isBaseline).toBe(true);
        expect(round.kindLabel).toBe('dataset baseline');
        expect(round.errorPatterns).toBeUndefined();
        expect(round.improvementSuggestions).toBeUndefined();
        expect(round.summaryFallback).toBe('generate first prompt from dataset samples');
        expect(round.experimentResult?.samplesDone).toBe(42);
        expect(round.experimentResult?.overallRow?.accuracy).toBe(0.66);
        expect(round.promptDiff?.fromText).toBe('');
        expect(round.promptDiff?.toText).toContain('Classify SQL risk');
        expect(round.promptDiff?.toText).toContain('## 输出格式');
        expect(round.promptDiff?.toText).toContain('"risk_level": <string>');
        expect(round.promptDiff?.toText).toContain('SQL 风险等级：safe / risky');
      });

      it('produces overallRow and class rows with vsDelta against source experiment baseline metrics', async () => {
        // New semantics: every round's vsDelta is compared against the source experiment's metrics (no longer against the previous round).
        // Here we inject sourceExperimentMetrics into baseRow to verify that round 1 vsDelta = round1.acc - source.acc.
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(
          baseRow({
            sourceExperimentMetrics: {
              accuracy: 0.65,
              perClass: [
                { label: 'positive', precision: 0.7, recall: 0.66 },
                { label: 'negative', precision: 0.6, recall: 0.62 },
              ],
            },
          }),
        );
        repo.listRoundExperimentsForOptimization.mockResolvedValue([
          buildExperimentRow({
            experimentId: 'e0000000-0000-4000-8000-000000000000',
            experimentName: 'exp-round-0',
            roundIndex: 0,
            metrics: {
              accuracy: 0.65,
              perClass: [
                { label: 'positive', precision: 0.7, recall: 0.66 },
                { label: 'negative', precision: 0.6, recall: 0.62 },
              ],
            },
          }),
          buildExperimentRow({
            experimentId: 'e1111111-1111-4111-8111-111111111111',
            experimentName: 'exp-round-1',
            roundIndex: 1,
            status: 'success',
            metrics: {
              accuracy: 0.73,
              perClass: [
                { label: 'positive', precision: 0.78, recall: 0.72 },
                { label: 'negative', precision: 0.66, recall: 0.69 },
              ],
            },
          }),
        ]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([]);
        repo.loadPromptVersionsByIds.mockResolvedValue(new Map());

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        const round1 = result.rounds.find((r) => r.index === 1)!;
        expect(round1.experimentResult?.overallRow).toMatchObject({
          accuracy: 0.73,
          vsLabel: 'baseline',
          vsTone: 'ok',
        });
        expect(round1.experimentResult?.overallRow?.vsDelta).toBeCloseTo(0.08, 5);
        expect(round1.experimentResult?.overallRow?.deltas?.accuracy).toMatchObject({
          vsLabel: 'baseline',
          tone: 'ok',
        });
        expect(round1.experimentResult?.overallRow?.deltas?.accuracy?.value).toBeCloseTo(0.08, 5);
        const positiveRow = round1.experimentResult?.classRows.find((r) => r.label === 'positive');
        expect(positiveRow).toMatchObject({ precision: 0.78, recall: 0.72, vsLabel: 'baseline', vsTone: 'ok' });
        expect(positiveRow?.vsDelta).toBeCloseTo(0.08, 5);
        expect(positiveRow?.deltas?.precision?.value).toBeCloseTo(0.08, 5);
        expect(positiveRow?.deltas?.recall?.value).toBeCloseTo(0.06, 5);
        // Likewise, round 0 is also compared against the source experiment (itself) → vsDelta=0 (within ±0.001 → neutral)
        const round0 = result.rounds.find((r) => r.index === 0)!;
        expect(round0.experimentResult?.overallRow).toMatchObject({
          accuracy: 0.65,
          vsLabel: 'baseline',
          vsTone: 'neutral',
        });
        expect(round0.experimentResult?.overallRow?.vsDelta).toBeCloseTo(0, 5);
        expect(round0.experimentResult?.overallRow?.deltas?.accuracy?.value).toBeCloseTo(0, 5);
      });

      it('produces goalChips with achieved=hit when current >= target and respects class scope', async () => {
        // Class-scope goal: look up the matching metric in perClass by label.
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(
          baseRow({
            goals: [
              { metric: 'accuracy', comparator: 'gte', target: 0.6, scope: 'overall' },
              { metric: 'precision', comparator: 'gte', target: 0.7, scope: 'positive' },
            ],
          }),
        );
        repo.listRoundExperimentsForOptimization.mockResolvedValue([buildExperimentRow()]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([]);
        repo.loadPromptVersionsByIds.mockResolvedValue(new Map());

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        const chips = result.rounds[0]!.goalChips;
        expect(chips).toHaveLength(2);
        // Overall accuracy 0.7 >= 0.6 → hit
        expect(chips[0]).toEqual({
          label: 'Accuracy',
          targetText: '≥ 0.6',
          currentText: '0.700',
          achieved: 'hit',
        });
        // positive precision 0.75 >= 0.7 → hit
        expect(chips[1]).toEqual({
          label: 'positive Precision',
          targetText: '≥ 0.7',
          currentText: '0.750',
          achieved: 'hit',
        });
      });

      it('exposes errorPatterns and improvementSuggestions even when generate LLM has not finished yet', async () => {
        // Simulate the analysis LLM having finished while the generation LLM has not produced anything yet (the child experiment has not even started). At this point promptDiff should be empty,
        // but error samples / improvement suggestions must be immediately visible so the user can see intermediate output while the round is in the analysis stage.
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow());
        repo.listRoundExperimentsForOptimization.mockResolvedValue([
          buildExperimentRow({
            experimentId: 'e1111111-1111-4111-8111-111111111111',
            status: 'running',
            processedSamples: 0,
            metrics: null,
          }),
        ]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([buildAnalysisLlmRow()]);
        repo.loadPromptVersionsByIds.mockResolvedValue(new Map());

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        const round = result.rounds[0]!;
        expect(round.errorPatterns).toBeDefined();
        expect(round.errorPatterns).toHaveLength(2);
        expect(round.improvementSuggestions).toBeDefined();
        expect(round.improvementSuggestions).toHaveLength(2);
        expect(round.promptDiff).toBeUndefined();
        // experimentResult is still present (the experiment has been created) but in running state (fallback) with 0 progress
        expect(round.experimentResult?.samplesDone).toBe(0);
      });

      const buildStepRow = (overrides: Record<string, unknown> = {}) => ({
        optimizationId: 'a1111111-1111-4111-8111-111111111111',
        roundIndex: 1,
        step: 'error_analysis' as const,
        status: 'running' as const,
        errorClass: null,
        errorMessage: null,
        runResultId: null,
        experimentId: null,
        startedAt: new Date('2026-05-18T10:00:00Z'),
        finishedAt: null,
        attempt: 0,
        dbosWorkflowId: 'wf-1',
        createdAt: new Date('2026-05-18T10:00:00Z'),
        updatedAt: new Date('2026-05-18T10:00:00Z'),
        ...overrides,
      });

      it('renders a round card from round_steps even when experiment row does not exist yet', async () => {
        // Analysis stage: only the round_steps rows contain error_analysis=running; the experiments table has no entry for this round yet
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow());
        repo.listRoundExperimentsForOptimization.mockResolvedValue([]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([]);
        repo.listRoundStepsForOptimization.mockResolvedValue([
          buildStepRow({ step: 'error_analysis', status: 'running' }),
        ]);
        repo.loadPromptVersionsByIds.mockResolvedValue(new Map());

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        expect(result.rounds).toHaveLength(1);
        expect(result.currentRound).toBe(1);
        expect(result.updatedAt).toBe('2026-05-18T10:00:00.000Z');
        const round = result.rounds[0]!;
        expect(round.index).toBe(1);
        expect(round.status).toBe('running');
        expect(round.steps).toHaveLength(1);
        expect(round.steps[0]).toMatchObject({ step: 'error_analysis', status: 'running' });
        // At this stage there is no experiment row; these fields should be undefined / empty
        expect(round.experimentResult).toBeUndefined();
        expect(round.experimentId).toBeNull();
        expect(round.metrics).toEqual([]);
      });

      it('merges round_steps with experiments by roundIndex without duplication', async () => {
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow());
        repo.listRoundExperimentsForOptimization.mockResolvedValue([buildExperimentRow()]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([]);
        repo.listRoundStepsForOptimization.mockResolvedValue([
          buildStepRow({ step: 'error_analysis', status: 'success' }),
          buildStepRow({ step: 'generate_prompt', status: 'success' }),
          buildStepRow({ step: 'experiment', status: 'running' }),
        ]);
        repo.loadPromptVersionsByIds.mockResolvedValue(new Map());

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        expect(result.rounds).toHaveLength(1);
        const round = result.rounds[0]!;
        expect(round.steps).toHaveLength(3);
        // experiment step running ⇒ the entire round status=running
        expect(round.status).toBe('running');
        // experiment row exists → experimentResult is still present
        expect(round.experimentResult).toBeDefined();
      });

      it('propagates step errorMessage when error_analysis failed', async () => {
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow());
        repo.listRoundExperimentsForOptimization.mockResolvedValue([]);
        repo.listOptimizationLlmRunResults.mockResolvedValue([]);
        repo.listRoundStepsForOptimization.mockResolvedValue([
          buildStepRow({
            step: 'error_analysis',
            status: 'failed',
            errorClass: 'TimeoutError',
            errorMessage: 'analysis_llm_timeout_after_120s',
            finishedAt: new Date('2026-05-18T10:02:00Z'),
          }),
        ]);
        repo.loadPromptVersionsByIds.mockResolvedValue(new Map());

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);
        const round = result.rounds[0]!;
        expect(round.status).toBe('failed');
        expect(round.steps[0]).toMatchObject({
          step: 'error_analysis',
          status: 'failed',
          errorClass: 'TimeoutError',
          errorMessage: 'analysis_llm_timeout_after_120s',
        });
      });
    });

    describe('live aggregate for running rounds', () => {
      it('overrides running round processedSamples / failedSamples / metrics with live aggregate from run_results', async () => {
        // Old snapshot (written back by the previous batch aggregation): 60 done / accuracy 0.7. The run_results table has accumulated 70 terminal rows
        // (65 correct A + 5 error) → the live aggregate should push progress to 70 and accuracy to 65/70.
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow());
        repo.listRoundExperimentsForOptimization.mockResolvedValue([
          {
            experimentId: 'e1111111-1111-4111-8111-111111111111',
            experimentName: 'exp-running',
            roundIndex: 1,
            promptVersionId: 'pv1111111-1111-4111-8111-111111111111',
            promptVersionNumber: 2,
            parentVersionId: null,
            status: 'running',
            metrics: { accuracy: 0.7 },
            failureReason: null,
            startedAt: new Date('2026-05-18T10:00:00Z'),
            finishedAt: null,
            totalSamples: 100,
            processedSamples: 60,
            failedSamples: 0,
          },
        ]);
        runResults.aggregateExperiment.mockResolvedValue([
          {
            decisionOutput: 'A',
            expectedOutput: 'A',
            judgmentStatus: 'correct',
            status: 'success',
            count: 65,
            inputTokens: 0,
            outputTokens: 0,
            costEstimate: 0,
          },
          {
            decisionOutput: null,
            expectedOutput: null,
            judgmentStatus: null,
            status: 'failed',
            count: 5,
            inputTokens: 0,
            outputTokens: 0,
            costEstimate: 0,
          },
        ]);

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);

        expect(runResults.aggregateExperiment).toHaveBeenCalledWith('e1111111-1111-4111-8111-111111111111');
        expect(runResults.aggregateExperimentLatency).toHaveBeenCalledWith('e1111111-1111-4111-8111-111111111111');
        const exp = result.rounds[0]?.experimentResult;
        // experimentResult is derived from the round fields after override: samplesDone goes to 70, accuracy goes to 65/70
        expect(exp?.samplesDone).toBe(70);
        expect(exp?.overallRow?.accuracy).toBeCloseTo(65 / 70, 5);
        // wrong = samplesDone - round(accuracy * samplesDone) = 70 - 65 = 5
        expect(exp?.wrong).toBe(5);
      });

      it('preserves snapshot when live aggregate is empty (run_results has no terminal row yet)', async () => {
        // Edge case: a running round has just started, no terminal row in run_results yet, aggregate returns empty.
        // The experiments snapshot must be preserved (it may be 0/null, or an intermediate state written by a previous batch),
        // to avoid regressing the progress to 0/null.
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow());
        repo.listRoundExperimentsForOptimization.mockResolvedValue([
          {
            experimentId: 'e2222222-2222-4222-8222-222222222222',
            experimentName: 'exp-running-snapshot',
            roundIndex: 1,
            promptVersionId: 'pv2222222-2222-4222-8222-222222222222',
            promptVersionNumber: 2,
            parentVersionId: null,
            status: 'running',
            metrics: { accuracy: 0.7 },
            failureReason: null,
            startedAt: new Date('2026-05-18T10:00:00Z'),
            finishedAt: null,
            totalSamples: 100,
            processedSamples: 50,
            failedSamples: 0,
          },
        ]);
        // makeRunResultService returns an empty aggregate by default

        const result = await service.getOptimization(projectAccess().id, baseRow().id, actor);

        expect(runResults.aggregateExperiment).toHaveBeenCalledWith('e2222222-2222-4222-8222-222222222222');
        const exp = result.rounds[0]?.experimentResult;
        // Snapshot preserved: processedSamples=50, accuracy=0.7
        expect(exp?.samplesDone).toBe(50);
        expect(exp?.overallRow?.accuracy).toBeCloseTo(0.7, 5);
      });

      it('skips aggregation calls for non-running rounds', async () => {
        // Terminal rounds use the snapshot directly to avoid triggering a GROUP BY on every GET.
        repo.findProjectAccess.mockResolvedValue(projectAccess());
        repo.findOptimizationById.mockResolvedValue(baseRow({ status: 'success' }));
        repo.listRoundExperimentsForOptimization.mockResolvedValue([
          {
            experimentId: 'e3333333-3333-4333-8333-333333333333',
            experimentName: 'exp-success',
            roundIndex: 1,
            promptVersionId: 'pv3333333-3333-4333-8333-333333333333',
            promptVersionNumber: 2,
            parentVersionId: null,
            status: 'success',
            metrics: { accuracy: 0.85 },
            failureReason: null,
            startedAt: new Date('2026-05-18T10:00:00Z'),
            finishedAt: new Date('2026-05-18T10:30:00Z'),
            totalSamples: 100,
            processedSamples: 100,
            failedSamples: 0,
          },
          {
            experimentId: 'e4444444-4444-4444-8444-444444444444',
            experimentName: 'exp-failed',
            roundIndex: 2,
            promptVersionId: 'pv4444444-4444-4444-8444-444444444444',
            promptVersionNumber: 3,
            parentVersionId: null,
            status: 'failed',
            metrics: null,
            failureReason: 'analysis_failed',
            startedAt: new Date('2026-05-18T11:00:00Z'),
            finishedAt: new Date('2026-05-18T11:05:00Z'),
            totalSamples: 100,
            processedSamples: 30,
            failedSamples: 30,
          },
        ]);

        await service.getOptimization(projectAccess().id, baseRow().id, actor);

        expect(runResults.aggregateExperiment).not.toHaveBeenCalled();
        expect(runResults.aggregateExperimentLatency).not.toHaveBeenCalled();
      });
    });
  });

  describe('createOptimization', () => {
    it('inserts a running row, auto-launches workflow, and returns the mapped DTO', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      experimentRepo.findExperimentById.mockResolvedValue(sourceExperimentRow);
      repo.insertOptimization.mockResolvedValue('new-id-001');
      repo.findOptimizationById.mockResolvedValue(baseRow({ id: 'new-id-001', status: 'running' }));

      const result = await service.createOptimization(projectAccess().id, createInput, actor);

      expect(repo.insertOptimization).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: projectAccess().id,
          name: createInput.name,
          strategy: 'error_pattern_analysis',
          startingMode: 'from_experiment',
          experimentModelId: createInput.experimentModelId,
          analysisModelId: createInput.analysisModelId,
          maxRounds: 10,
          stopAfterNoImprovementRounds: 2,
          status: 'running',
          createdBy: actor.sub,
        }),
      );
      // orgId is SaaS-only; the OSS test actor has none, so launch is invoked with orgId=undefined.
      expect(launcher.launch).toHaveBeenCalledWith('new-id-001', undefined);
      expect(result.id).toBe('new-id-001');
      expect(result.status).toBe('running');
    });

    it('rejects duplicate optimization names before resolving references', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationByProjectAndName.mockResolvedValue(baseRow({ name: createInput.name }));

      await expect(service.createOptimization(projectAccess().id, createInput, actor)).rejects.toThrow(
        new ConflictException('optimization_name_taken'),
      );

      expect(experimentRepo.findExperimentById).not.toHaveBeenCalled();
      expect(repo.insertOptimization).not.toHaveBeenCalled();
      expect(launcher.launch).not.toHaveBeenCalled();
    });

    it('maps optimization name unique violations to optimization_name_taken', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      experimentRepo.findExperimentById.mockResolvedValue(sourceExperimentRow);
      repo.insertOptimization.mockRejectedValue(
        Object.assign(
          new Error('duplicate key value violates unique constraint "idx_optimization_project_name_active"'),
          {
            code: '23505',
            constraint: 'idx_optimization_project_name_active',
          },
        ),
      );

      await expect(service.createOptimization(projectAccess().id, createInput, actor)).rejects.toThrow(
        new ConflictException('optimization_name_taken'),
      );

      expect(launcher.launch).not.toHaveBeenCalled();
    });

    it('resolves promptId + baseVersionId from sourceExperiment for from_experiment payloads with nulls', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      experimentRepo.findExperimentById.mockResolvedValue(sourceExperimentRow);
      repo.insertOptimization.mockResolvedValue('new-id-resolve');
      repo.findOptimizationById.mockResolvedValue(baseRow({ id: 'new-id-resolve', status: 'running' }));

      await service.createOptimization(projectAccess().id, createInput, actor);

      expect(experimentRepo.findExperimentById).toHaveBeenCalledWith(
        projectAccess().id,
        createInput.sourceExperimentId,
      );
      expect(repo.insertOptimization).toHaveBeenCalledWith(
        expect.objectContaining({
          promptId: sourceExperimentRow.promptId,
          baseVersionId: sourceExperimentRow.promptVersionId,
          sourceExperimentId: createInput.sourceExperimentId,
        }),
      );
    });

    it('stores trimmed optimizationHint for from_experiment', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      experimentRepo.findExperimentById.mockResolvedValue(sourceExperimentRow);
      repo.insertOptimization.mockResolvedValue('new-id-hint');
      repo.findOptimizationById.mockResolvedValue(
        baseRow({ id: 'new-id-hint', status: 'running', optimizationHint: '优先保持提示词简洁' }),
      );

      await service.createOptimization(
        projectAccess().id,
        { ...createInput, optimizationHint: '  优先保持提示词简洁  ' },
        actor,
      );

      expect(repo.insertOptimization).toHaveBeenCalledWith(
        expect.objectContaining({
          startingMode: 'from_experiment',
          optimizationHint: '优先保持提示词简洁',
        }),
      );
    });

    it('throws BadRequest when sourceExperiment is missing for from_experiment', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      experimentRepo.findExperimentById.mockResolvedValue(null);

      await expect(service.createOptimization(projectAccess().id, createInput, actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(repo.insertOptimization).not.toHaveBeenCalled();
    });

    it('does not query experimentRepo when startingMode is from_prompt_version', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.insertOptimization.mockResolvedValue('new-id-prompt');
      repo.findOptimizationById.mockResolvedValue(baseRow({ id: 'new-id-prompt', status: 'running' }));

      const promptInput: CreateOptimizationDto = {
        ...createInput,
        startingMode: 'from_prompt_version',
        sourceExperimentId: null,
        promptId: 'p2222222-2222-4222-8222-222222222222',
        baseVersionId: 'v2222222-2222-4222-8222-222222222222',
        optimizationHint: '按现有结构微调',
      };

      await service.createOptimization(projectAccess().id, promptInput, actor);

      expect(experimentRepo.findExperimentById).not.toHaveBeenCalled();
      // baseVersionId is provided explicitly; repo.findActiveVersionIdForPrompt fallback must not be triggered
      expect(repo.findActiveVersionIdForPrompt).not.toHaveBeenCalled();
      expect(repo.insertOptimization).toHaveBeenCalledWith(
        expect.objectContaining({
          startingMode: 'from_prompt_version',
          promptId: promptInput.promptId,
          baseVersionId: promptInput.baseVersionId,
          sourceExperimentId: null,
          optimizationHint: '按现有结构微调',
        }),
      );
    });

    it('auto-resolves baseVersionId via repo.findActiveVersionIdForPrompt for from_prompt_version with null baseVersionId', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.insertOptimization.mockResolvedValue('new-id-prompt-resolve');
      repo.findOptimizationById.mockResolvedValue(baseRow({ id: 'new-id-prompt-resolve', status: 'running' }));
      const resolvedVersionId = 'v3333333-3333-4333-8333-333333333333';
      repo.findActiveVersionIdForPrompt.mockResolvedValue(resolvedVersionId);

      const promptInput: CreateOptimizationDto = {
        ...createInput,
        startingMode: 'from_prompt_version',
        sourceExperimentId: null,
        promptId: 'p2222222-2222-4222-8222-222222222222',
        baseVersionId: null,
        optimizationHint: '   ',
      };

      await service.createOptimization(projectAccess().id, promptInput, actor);

      expect(repo.findActiveVersionIdForPrompt).toHaveBeenCalledWith(promptInput.promptId);
      expect(experimentRepo.findExperimentById).not.toHaveBeenCalled();
      expect(repo.insertOptimization).toHaveBeenCalledWith(
        expect.objectContaining({
          startingMode: 'from_prompt_version',
          promptId: promptInput.promptId,
          baseVersionId: resolvedVersionId,
          sourceExperimentId: null,
          optimizationHint: null,
        }),
      );
      expect(launcher.launch).toHaveBeenCalledWith('new-id-prompt-resolve', undefined);
    });

    it('throws BadRequest when prompt has no usable version for from_prompt_version', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findActiveVersionIdForPrompt.mockResolvedValue(null);

      const promptInput: CreateOptimizationDto = {
        ...createInput,
        startingMode: 'from_prompt_version',
        sourceExperimentId: null,
        promptId: 'p2222222-2222-4222-8222-222222222222',
        baseVersionId: null,
      };

      await expect(service.createOptimization(projectAccess().id, promptInput, actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(repo.findActiveVersionIdForPrompt).toHaveBeenCalledWith(promptInput.promptId);
      expect(repo.insertOptimization).not.toHaveBeenCalled();
      expect(launcher.launch).not.toHaveBeenCalled();
    });

    it('auto-creates an empty placeholder prompt for from_dataset_only and leaves baseVersionId null (SPEC 25 §2.1)', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findDatasetForOptimization.mockResolvedValue({
        id: 'd1111111-1111-4111-8111-111111111111',
        name: 'customer-feedback',
      });
      promptRepo.createPlaceholderPromptForOptimization.mockResolvedValue('p9999999-9999-4999-8999-999999999999');
      repo.insertOptimization.mockResolvedValue('new-id-dataset');
      repo.findOptimizationById.mockResolvedValue(baseRow({ id: 'new-id-dataset', status: 'running' }));

      const datasetInput: CreateOptimizationDto = {
        ...createInput,
        startingMode: 'from_dataset_only',
        sourceExperimentId: null,
        promptId: null,
        baseVersionId: null,
        datasetId: 'd1111111-1111-4111-8111-111111111111',
        optimizationHint: '先生成简洁首版',
      };

      await service.createOptimization(projectAccess().id, datasetInput, actor);

      expect(repo.findDatasetForOptimization).toHaveBeenCalledWith(projectAccess().id, datasetInput.datasetId);
      expect(promptRepo.createPlaceholderPromptForOptimization).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: projectAccess().id,
          defaultDatasetId: datasetInput.datasetId,
          createdBy: actor.sub,
          // Name matches the `Optimization-${datasetName}-${ISO time}` template
          name: expect.stringMatching(/^优化-customer-feedback-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
        }),
      );
      expect(repo.insertOptimization).toHaveBeenCalledWith(
        expect.objectContaining({
          startingMode: 'from_dataset_only',
          promptId: 'p9999999-9999-4999-8999-999999999999',
          baseVersionId: null,
          sourceExperimentId: null,
          optimizationHint: '先生成简洁首版',
        }),
      );
      expect(launcher.launch).toHaveBeenCalledWith('new-id-dataset', undefined);
    });

    it('rejects workflow authorization before creating placeholder prompts, inserting rows, or launching', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findDatasetForOptimization.mockResolvedValue({
        id: 'd1111111-1111-4111-8111-111111111111',
        name: 'customer-feedback',
      });
      workflowAuth.assertCanStart.mockRejectedValueOnce(new Error('workflow_denied'));

      const datasetInput: CreateOptimizationDto = {
        ...createInput,
        startingMode: 'from_dataset_only',
        sourceExperimentId: null,
        promptId: null,
        baseVersionId: null,
        datasetId: 'd1111111-1111-4111-8111-111111111111',
      };

      await expect(service.createOptimization(projectAccess().id, datasetInput, actor)).rejects.toThrow(
        'workflow_denied',
      );

      expect(workflowAuth.assertCanStart).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: actor.sub }),
        { projectId: projectAccess().id, source: 'local' },
        'optimization',
      );
      expect(promptRepo.createPlaceholderPromptForOptimization).not.toHaveBeenCalled();
      expect(repo.insertOptimization).not.toHaveBeenCalled();
      expect(launcher.launch).not.toHaveBeenCalled();
    });

    it('throws BadRequest when dataset is missing for from_dataset_only', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findDatasetForOptimization.mockResolvedValue(null);

      const datasetInput: CreateOptimizationDto = {
        ...createInput,
        startingMode: 'from_dataset_only',
        sourceExperimentId: null,
        promptId: null,
        baseVersionId: null,
        datasetId: 'd9999999-9999-4999-8999-999999999999',
      };

      await expect(service.createOptimization(projectAccess().id, datasetInput, actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(repo.findDatasetForOptimization).toHaveBeenCalledWith(projectAccess().id, datasetInput.datasetId);
      expect(promptRepo.createPlaceholderPromptForOptimization).not.toHaveBeenCalled();
      expect(repo.insertOptimization).not.toHaveBeenCalled();
    });

    it('rejects from_dataset_only when baseVersionId already supplied (must be unset)', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());

      const datasetInput: CreateOptimizationDto = {
        ...createInput,
        startingMode: 'from_dataset_only',
        sourceExperimentId: null,
        promptId: null,
        baseVersionId: 'v8888888-8888-4888-8888-888888888888',
        datasetId: 'd1111111-1111-4111-8111-111111111111',
      };

      await expect(service.createOptimization(projectAccess().id, datasetInput, actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(promptRepo.createPlaceholderPromptForOptimization).not.toHaveBeenCalled();
      expect(repo.insertOptimization).not.toHaveBeenCalled();
    });

    it('writes failure summary into DB when launcher.launch throws (so detail page can show reason)', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      experimentRepo.findExperimentById.mockResolvedValue(sourceExperimentRow);
      repo.insertOptimization.mockResolvedValue('new-id-002');
      launcher.launch.mockRejectedValueOnce(new Error('dbos workflow registration not ready'));

      await expect(service.createOptimization(projectAccess().id, createInput, actor)).rejects.toThrowError(
        'dbos workflow registration not ready',
      );

      const updateCall = repo.updateOptimization.mock.calls[0];
      expect(updateCall?.[0]).toBe(projectAccess().id);
      expect(updateCall?.[1]).toBe('new-id-002');
      const patch = updateCall?.[2] as { status?: string; summary?: { kind?: string; reason?: string } };
      expect(patch.status).toBe('failed');
      expect(patch.summary).toMatchObject({
        kind: 'failed',
        reason: expect.stringContaining('launch_failed: dbos workflow registration not ready'),
      });
    });
  });

  describe('controlOptimization', () => {
    it('stop running → 抢占式终态化 status=stopped + control_state=stop + finishedAt', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById
        .mockResolvedValueOnce(baseRow({ status: 'running' }))
        // The second find simulates the workflow already flipping to stopped after observing the change at a step boundary
        .mockResolvedValueOnce(baseRow({ status: 'stopped', controlState: 'stop' }));

      const result = await service.controlOptimization(projectAccess().id, baseRow().id, 'stop', actor);

      expect(repo.updateOptimization).toHaveBeenCalledWith(
        projectAccess().id,
        baseRow().id,
        // The service now preempts the terminal state: status=stopped + control_state=stop + finishedAt
        // The workflow's subsequent finalize is skipped because the repo.finalize guard (status='running') is not satisfied
        expect.objectContaining({
          status: 'stopped',
          objectiveStatus: 'not_met',
          controlState: 'stop',
          finishedAt: expect.any(Date),
        }),
      );
      expect(result.status).toBe('stopped');
    });

    it('resume stopped → running + control_state=resume + launcher.resume', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById
        .mockResolvedValueOnce(baseRow({ status: 'stopped' }))
        .mockResolvedValueOnce(baseRow({ status: 'running', controlState: 'resume' }));

      await service.controlOptimization(projectAccess().id, baseRow().id, 'resume', actor);

      expect(repo.updateOptimization).toHaveBeenCalledWith(
        projectAccess().id,
        baseRow().id,
        expect.objectContaining({
          status: 'running',
          objectiveStatus: 'pending',
          controlState: 'resume',
          finishedAt: null,
        }),
      );
      // orgId is SaaS-only; the OSS test actor has none, so resume is invoked with orgId=undefined.
      expect(launcher.resume).toHaveBeenCalledWith(baseRow().id, undefined);
    });

    it('cancel running → 抢占式终态化 status=cancelled + control_state=cancel + finishedAt', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById
        .mockResolvedValueOnce(baseRow({ status: 'running' }))
        .mockResolvedValueOnce(baseRow({ status: 'cancelled', controlState: 'cancel' }));

      await service.controlOptimization(projectAccess().id, baseRow().id, 'cancel', actor);

      expect(repo.updateOptimization).toHaveBeenCalledWith(
        projectAccess().id,
        baseRow().id,
        expect.objectContaining({
          status: 'cancelled',
          objectiveStatus: 'not_met',
          controlState: 'cancel',
          finishedAt: expect.any(Date),
        }),
      );
    });

    it('rejects stop on already-success', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(baseRow({ status: 'success' }));

      await expect(service.controlOptimization(projectAccess().id, baseRow().id, 'stop', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects resume on running', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(baseRow({ status: 'running' }));

      await expect(
        service.controlOptimization(projectAccess().id, baseRow().id, 'resume', actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects cancel on already-cancelled', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(baseRow({ status: 'cancelled' }));

      await expect(
        service.controlOptimization(projectAccess().id, baseRow().id, 'cancel', actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    // SPEC 25 §7 dual-path linkage: stop/cancel on the parent optimization immediately invokes controlExperiment on the child
    it('stop running + active 子实验 → 调 experimentService.controlExperiment("stop")', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById
        .mockResolvedValueOnce(baseRow({ status: 'running' }))
        .mockResolvedValueOnce(baseRow({ status: 'running', controlState: 'stop' }));
      repo.findActiveChildExperiment.mockResolvedValue({
        id: 'e1111111-1111-4111-8111-111111111111',
        projectId: projectAccess().id,
        status: 'running',
        roundIndex: 3,
      });

      await service.controlOptimization(projectAccess().id, baseRow().id, 'stop', actor);

      expect(experimentService.controlExperiment).toHaveBeenCalledTimes(1);
      expect(experimentService.controlExperiment).toHaveBeenCalledWith(
        projectAccess().id,
        'e1111111-1111-4111-8111-111111111111',
        'stop',
        expect.objectContaining({ sub: '00000000-0000-0000-0000-000000000000', isSuperAdmin: true }),
        'system',
      );
    });

    it('cancel running + active 子实验 → 调 experimentService.controlExperiment("cancel")', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById
        .mockResolvedValueOnce(baseRow({ status: 'running' }))
        .mockResolvedValueOnce(baseRow({ status: 'running', controlState: 'cancel' }));
      repo.findActiveChildExperiment.mockResolvedValue({
        id: 'e2222222-2222-4222-8222-222222222222',
        projectId: projectAccess().id,
        status: 'stopped',
        roundIndex: 2,
      });

      await service.controlOptimization(projectAccess().id, baseRow().id, 'cancel', actor);

      expect(experimentService.controlExperiment).toHaveBeenCalledWith(
        projectAccess().id,
        'e2222222-2222-4222-8222-222222222222',
        'cancel',
        expect.anything(),
        'system',
      );
    });

    it('stop + 无 active 子实验 → experimentService 未被调', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById
        .mockResolvedValueOnce(baseRow({ status: 'running' }))
        .mockResolvedValueOnce(baseRow({ status: 'running', controlState: 'stop' }));
      repo.findActiveChildExperiment.mockResolvedValue(null);

      await service.controlOptimization(projectAccess().id, baseRow().id, 'stop', actor);

      expect(experimentService.controlExperiment).not.toHaveBeenCalled();
    });

    it('stop + 子实验抛 ConflictException → 父 control_state 仍正常落库返回', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById
        .mockResolvedValueOnce(baseRow({ status: 'running' }))
        .mockResolvedValueOnce(baseRow({ status: 'running', controlState: 'stop' }));
      repo.findActiveChildExperiment.mockResolvedValue({
        id: 'e3333333-3333-4333-8333-333333333333',
        projectId: projectAccess().id,
        status: 'running',
        roundIndex: 1,
      });
      experimentService.controlExperiment.mockRejectedValue(new ConflictException('experiment_stop_invalid_status'));

      await expect(service.controlOptimization(projectAccess().id, baseRow().id, 'stop', actor)).resolves.toBeDefined();

      expect(repo.updateOptimization).toHaveBeenCalledWith(
        projectAccess().id,
        baseRow().id,
        expect.objectContaining({ controlState: 'stop' }),
      );
    });

    it('stop + 子实验抛未知错误 → 父 control_state 仍正常落库返回(workflow poll 兜底)', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById
        .mockResolvedValueOnce(baseRow({ status: 'running' }))
        .mockResolvedValueOnce(baseRow({ status: 'running', controlState: 'stop' }));
      repo.findActiveChildExperiment.mockResolvedValue({
        id: 'e4444444-4444-4444-8444-444444444444',
        projectId: projectAccess().id,
        status: 'running',
        roundIndex: 1,
      });
      experimentService.controlExperiment.mockRejectedValue(new Error('connection refused'));

      await expect(service.controlOptimization(projectAccess().id, baseRow().id, 'stop', actor)).resolves.toBeDefined();
    });

    it('resume stopped → experimentService 不被调(子实验由 workflow 在 isResumeRound 分支起)', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById
        .mockResolvedValueOnce(baseRow({ status: 'stopped' }))
        .mockResolvedValueOnce(baseRow({ status: 'running', controlState: 'resume' }));

      await service.controlOptimization(projectAccess().id, baseRow().id, 'resume', actor);

      expect(experimentService.controlExperiment).not.toHaveBeenCalled();
      expect(launcher.resume).toHaveBeenCalledWith(baseRow().id, undefined);
    });
  });

  describe('deleteOptimization', () => {
    it('hard-deletes', async () => {
      repo.findProjectAccess.mockResolvedValue(projectAccess());
      repo.findOptimizationById.mockResolvedValue(baseRow());

      await service.deleteOptimization(projectAccess().id, baseRow().id, actor);

      expect(repo.hardDeleteOptimization).toHaveBeenCalledWith(projectAccess().id, baseRow().id);
    });
  });
});
