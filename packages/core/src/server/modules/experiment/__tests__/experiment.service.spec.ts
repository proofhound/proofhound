import { ConflictException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { Test, type TestingModule } from '@nestjs/testing';
import { DATABASE_CLIENT } from '../../../../shared/database/database.constants';
import { ModelService } from '../../model/model.service';
import { RunResultService } from '../../run-result/run-result.service';
import { ExperimentLauncher } from '../experiment.launcher';
import { ExperimentRepository, type ExperimentProjectAccessRow, type ExperimentRow } from '../experiment.repository';
import { ExperimentService } from '../experiment.service';
import { AccessControlService } from '../../../common/contracts/access-control.service';
import { LocalAccessControlService } from '../../../common/contracts/local-access-control.service';
import { ObjectStorageProvider, type StoredObjectRef } from '../../../common/contracts/object-storage.provider';
import { WorkflowAuthorizationHook } from '../../../common/contracts/workflow-authorization.hook';
import { vi, type Mocked, type Mock } from 'vitest';

const actor = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'alice@example.com',
  isSuperAdmin: false,
  isActive: true,
};

const projectAccess = (): ExperimentProjectAccessRow => ({
  id: '77777777-7777-4777-8777-777777777777',
});

const experimentRow = (overrides: Partial<ExperimentRow> = {}): ExperimentRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  projectId: '77777777-7777-4777-8777-777777777777',
  name: 'exp-2026-0518-sql-risk',
  optimizationId: null,
  roundIndex: null,
  promptId: '66666666-6666-4666-8666-666666666666',
  promptVersionId: '33333333-3333-4333-8333-333333333333',
  promptName: 'sql-risk-judge',
  promptVersionNumber: 17,
  promptVariables: [{ name: 'text', type: 'text', required: true, datasetField: 'text' }],
  promptOutputSchema: null,
  datasetId: '44444444-4444-4444-8444-444444444444',
  datasetName: 'sql-risk-eval-v3',
  datasetSamples: 1200,
  datasetHasImages: false,
  datasetFieldSchema: [
    { name: 'text', type: 'string', role: 'text' },
    { name: 'label', type: 'string', role: 'expected_output' },
  ],
  modelId: '55555555-5555-4555-8555-555555555555',
  modelName: 'Qwen 3.6 Flash',
  providerModelId: 'qwen3.6-flash',
  status: 'running',
  controlState: null,
  totalSamples: 1200,
  processedSamples: 420,
  failedSamples: 3,
  metrics: {
    accuracy: 0.86,
    precision: 0.84,
    recall: 0.88,
    f1: 0.86,
    inputTokens: 120000,
    outputTokens: 8400,
    costEstimate: 0.42,
  },
  runConfig: {
    concurrency: 8,
    rpmLimit: 60,
    tpmLimit: 100000,
    temperature: 0.3,
    description: 'SQL 高风险操作回归',
  },
  dbosWorkflowId: 'exp-workflow-1',
  failureKind: null,
  failureReason: null,
  createdBy: actor.sub,
  createdByDisplayName: 'Alice',
  createdByUsername: 'alice',
  startedAt: new Date('2026-05-18T08:00:00Z'),
  finishedAt: null,
  createdAt: new Date('2026-05-18T07:55:00Z'),
  updatedAt: new Date('2026-05-18T08:08:00Z'),
  deletedAt: null,
  ...overrides,
});

function makeRepo(): Mocked<ExperimentRepository> {
  return {
    findProjectAccess: vi.fn(),
    listExperiments: vi.fn(),
    findExperimentById: vi.fn(),
    findExperimentByProjectAndName: vi.fn(),
    createExperiment: vi.fn(),
    updateExperiment: vi.fn(),
    hasProductionReleaseSourceReference: vi.fn().mockResolvedValue(false),
    hardDeleteExperiment: vi.fn().mockResolvedValue({ deleted: 1, payloadRefs: [] }),
  } as unknown as Mocked<ExperimentRepository>;
}

function makeRunResults(): Mocked<RunResultService> {
  return {
    aggregateExperiment: vi.fn().mockResolvedValue([]),
    aggregateExperimentLatency: vi.fn().mockResolvedValue({ averageMs: null, p50Ms: null, p95Ms: null }),
    countBatchTerminal: vi.fn(),
    listExperimentRunResults: vi.fn(),
    getExperimentRunResult: vi.fn(),
    exportExperimentRunResults: vi.fn(),
  } as unknown as Mocked<RunResultService>;
}

function makeSelectQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue(rows),
  };

  return query;
}

async function readBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

describe('ExperimentService', () => {
  let service: ExperimentService;
  let repo: Mocked<ExperimentRepository>;
  let launcher: { launch: Mock; resume: Mock; retry: Mock };
  let modelService: Mocked<ModelService>;
  let runResults: Mocked<RunResultService>;
  let db: { select: Mock; update: Mock };
  let workflowAuth: Mocked<WorkflowAuthorizationHook>;
  let objectStorage: { isEnabled: Mock; deleteObjects: Mock };

  beforeEach(async () => {
    repo = makeRepo();
    runResults = makeRunResults();
    launcher = {
      launch: vi.fn().mockResolvedValue('exp:fake:start:1'),
      resume: vi.fn().mockResolvedValue('exp:fake:resume:1'),
      retry: vi.fn().mockResolvedValue('exp:fake:retry:1'),
    };
    modelService = {
      findModelAccessibleToProject: vi.fn().mockResolvedValue(null),
    } as unknown as Mocked<ModelService>;
    db = {
      select: vi.fn(),
      update: vi.fn(),
    };
    workflowAuth = {
      assertCanStart: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<WorkflowAuthorizationHook>;
    objectStorage = {
      isEnabled: vi.fn(() => true),
      deleteObjects: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: ExperimentRepository, useValue: repo },
        { provide: ExperimentLauncher, useValue: launcher },
        { provide: ModelService, useValue: modelService },
        { provide: RunResultService, useValue: runResults },
        { provide: DATABASE_CLIENT, useValue: db },
        { provide: AccessControlService, useClass: LocalAccessControlService },
        { provide: WorkflowAuthorizationHook, useValue: workflowAuth },
        { provide: ObjectStorageProvider, useValue: objectStorage },
        ExperimentService,
      ],
    }).compile();

    service = module.get(ExperimentService);
  });

  it('lists experiments with joined labels, stats, filtering, and accuracy sorting', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.listExperiments.mockResolvedValue([
      experimentRow({ id: '22222222-2222-4222-8222-222222222222', metrics: { accuracy: 0.86, f1: 0.84 } }),
      experimentRow({
        id: '66666666-6666-4666-8666-666666666666',
        name: 'exp-success',
        status: 'success',
        processedSamples: 1200,
        finishedAt: new Date('2026-05-18T08:30:00Z'),
        updatedAt: new Date('2026-05-18T08:30:00Z'),
        metrics: { accuracy: 0.91, f1: 0.9, inputTokens: 1000, outputTokens: 100, costEstimate: 0.01 },
      }),
    ]);

    const result = await service.listExperiments('77777777-7777-4777-8777-777777777777', actor, { sort: 'accuracy' });

    expect(result.total).toBe(2);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        id: '66666666-6666-4666-8666-666666666666',
        promptVersionLabel: 'v17',
        modelVariant: 'temp 0.3',
      }),
    );
    expect(result.stats.newThisWeek).toBeGreaterThanOrEqual(0);
    expect(result.stats.inputTokens).toBe(1000);
  });

  it('rejects duplicate experiment names before freezing or launching', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentByProjectAndName.mockResolvedValue(experimentRow({ name: 'baseline' }));

    await expect(
      service.createExperiment(
        '77777777-7777-4777-8777-777777777777',
        {
          name: 'baseline',
          promptVersionId: '33333333-3333-4333-8333-333333333333',
          datasetId: '44444444-4444-4444-8444-444444444444',
          modelId: '55555555-5555-4555-8555-555555555555',
        },
        actor,
      ),
    ).rejects.toThrow(new ConflictException('experiment_name_taken'));

    expect(repo.createExperiment).not.toHaveBeenCalled();
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it('creates experiments for large datasets without an implementation sample-count cap', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentByProjectAndName.mockResolvedValue(null);
    repo.createExperiment.mockResolvedValue('22222222-2222-4222-8222-222222222222');
    repo.findExperimentById.mockResolvedValue(
      experimentRow({ datasetSamples: 598000, totalSamples: 598000, processedSamples: 0 }),
    );
    modelService.findModelAccessibleToProject.mockResolvedValue({
      deletedAt: null,
      isActive: true,
    } as never);
    db.select
      .mockReturnValueOnce(
        makeSelectQuery([
          {
            promptVersionId: '33333333-3333-4333-8333-333333333333',
            promptId: '66666666-6666-4666-8666-666666666666',
            promptName: 'sql-risk-judge',
            versionNumber: 17,
            body: 'Judge {{text}}',
            variables: [{ name: 'text', type: 'text', required: true, datasetField: 'text' }],
            outputSchema: null,
            judgmentRules: null,
            isFrozen: true,
            promptDeletedAt: null,
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSelectQuery([
          {
            id: '44444444-4444-4444-8444-444444444444',
            sampleCount: 598000,
            deletedAt: null,
          },
        ]),
      );

    await service.createExperiment(
      '77777777-7777-4777-8777-777777777777',
      {
        name: 'large-yelp-full-run',
        promptVersionId: '33333333-3333-4333-8333-333333333333',
        datasetId: '44444444-4444-4444-8444-444444444444',
        modelId: '55555555-5555-4555-8555-555555555555',
      },
      actor,
    );

    expect(repo.createExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: '44444444-4444-4444-8444-444444444444',
        totalSamples: 598000,
      }),
    );
    expect(launcher.launch).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', undefined);
  });

  it('rejects workflow authorization before freezing, creating, or launching', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentByProjectAndName.mockResolvedValue(null);
    modelService.findModelAccessibleToProject.mockResolvedValue({
      deletedAt: null,
      isActive: true,
    } as never);
    workflowAuth.assertCanStart.mockRejectedValueOnce(new Error('workflow_denied'));
    db.select
      .mockReturnValueOnce(
        makeSelectQuery([
          {
            promptVersionId: '33333333-3333-4333-8333-333333333333',
            promptId: '66666666-6666-4666-8666-666666666666',
            promptName: 'sql-risk-judge',
            versionNumber: 17,
            body: 'Judge {{text}}',
            variables: [{ name: 'text', type: 'text', required: true, datasetField: 'text' }],
            outputSchema: null,
            judgmentRules: null,
            isFrozen: false,
            promptDeletedAt: null,
          },
        ]),
      )
      .mockReturnValueOnce(
        makeSelectQuery([
          {
            id: '44444444-4444-4444-8444-444444444444',
            sampleCount: 10,
            deletedAt: null,
          },
        ]),
      );

    await expect(
      service.createExperiment(
        '77777777-7777-4777-8777-777777777777',
        {
          name: 'blocked-start',
          promptVersionId: '33333333-3333-4333-8333-333333333333',
          datasetId: '44444444-4444-4444-8444-444444444444',
          modelId: '55555555-5555-4555-8555-555555555555',
        },
        actor,
      ),
    ).rejects.toThrow('workflow_denied');

    expect(workflowAuth.assertCanStart).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: actor.sub }),
      { projectId: '77777777-7777-4777-8777-777777777777', source: 'local' },
      'experiment',
    );
    expect(db.update).not.toHaveBeenCalled();
    expect(repo.createExperiment).not.toHaveBeenCalled();
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it('stops a running experiment', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById
      .mockResolvedValueOnce(experimentRow({ status: 'running' }))
      .mockResolvedValueOnce(experimentRow({ status: 'stopped', controlState: 'stop' }));

    const result = await service.controlExperiment(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      'stop',
      actor,
    );

    expect(repo.updateExperiment).toHaveBeenCalledWith(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      expect.objectContaining({ controlState: 'stop' }),
    );
    expect(repo.updateExperiment).toHaveBeenCalledWith(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      expect.not.objectContaining({ status: expect.anything() }),
    );
    // status only flips to stopped after the workflow observes control_state='stop' at a step boundary
    expect(result.controlState).toBe('stop');
  });

  it('treats legacy cancel as stop for running experiments', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById
      .mockResolvedValueOnce(experimentRow({ status: 'running' }))
      .mockResolvedValueOnce(experimentRow({ status: 'running', controlState: 'stop' }));

    await service.controlExperiment(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      'cancel',
      actor,
    );

    expect(repo.updateExperiment).toHaveBeenCalledWith(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      expect.objectContaining({ controlState: 'stop' }),
    );
    expect(launcher.resume).not.toHaveBeenCalled();
    expect(launcher.retry).not.toHaveBeenCalled();
  });

  it('accepts legacy cancel as a no-op for already stopped experiments', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById
      .mockResolvedValueOnce(experimentRow({ status: 'stopped', controlState: null }))
      .mockResolvedValueOnce(experimentRow({ status: 'stopped', controlState: null }));

    const result = await service.controlExperiment(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      'cancel',
      actor,
    );

    expect(repo.updateExperiment).toHaveBeenCalledWith(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      expect.objectContaining({ controlState: null }),
    );
    expect(result.status).toBe('stopped');
  });

  it('resume writes control_state and triggers launcher.resume', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById
      .mockResolvedValueOnce(experimentRow({ status: 'stopped' }))
      .mockResolvedValueOnce(experimentRow({ status: 'running', controlState: 'resume' }));

    await service.controlExperiment(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      'resume',
      actor,
    );

    expect(launcher.resume).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', undefined);
  });

  it('rejects resume unless the experiment is stopped', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById.mockResolvedValue(experimentRow({ status: 'running' }));

    await expect(
      service.controlExperiment(
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222',
        'resume',
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('hard-deletes an experiment', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById.mockResolvedValue(experimentRow());

    await service.deleteExperiment(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      actor,
    );

    expect(repo.hardDeleteExperiment).toHaveBeenCalledWith(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(objectStorage.deleteObjects).not.toHaveBeenCalled();
  });

  it('cleans offloaded run-result payload refs after hard-deleting an experiment', async () => {
    const payloadRef: StoredObjectRef = {
      provider: 'r2',
      bucket: 'proofhound-dev',
      key: 'orgs/org-1/projects/project-1/run_result_shard/22222222-2222-4222-8222-222222222222/gen1/shard-00000.jsonl.gz',
      bytes: 7114,
      codec: 'gzip',
      resourceType: 'run_result_shard',
      resourceId: '22222222-2222-4222-8222-222222222222',
    };
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById.mockResolvedValue(experimentRow());
    repo.hardDeleteExperiment.mockResolvedValue({ deleted: 1, payloadRefs: [payloadRef] });

    await service.deleteExperiment(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      actor,
    );

    expect(objectStorage.deleteObjects).toHaveBeenCalledWith([payloadRef]);
  });

  it('does not roll back experiment deletion when offloaded payload cleanup fails', async () => {
    const payloadRef: StoredObjectRef = {
      provider: 'r2',
      bucket: 'proofhound-dev',
      key: 'orgs/org-1/projects/project-1/run_result_shard/22222222-2222-4222-8222-222222222222/gen1/shard-00000.jsonl.gz',
      bytes: 7114,
      codec: 'gzip',
      resourceType: 'run_result_shard',
      resourceId: '22222222-2222-4222-8222-222222222222',
    };
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById.mockResolvedValue(experimentRow());
    repo.hardDeleteExperiment.mockResolvedValue({ deleted: 1, payloadRefs: [payloadRef] });
    objectStorage.deleteObjects.mockRejectedValueOnce(new Error('r2 unavailable'));

    await expect(
      service.deleteExperiment('77777777-7777-4777-8777-777777777777', '22222222-2222-4222-8222-222222222222', actor),
    ).resolves.toBeUndefined();
  });

  it('derives datasetModalities from dataset fieldSchema (text + image)', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.listExperiments.mockResolvedValue([
      experimentRow({
        datasetFieldSchema: [
          { name: 'question', type: 'string', role: 'text' },
          { name: 'screenshot', type: 'string', role: 'image_url' },
          { name: 'label', type: 'string', role: 'expected_output' },
        ],
        datasetHasImages: true,
      }),
    ]);

    const result = await service.listExperiments('77777777-7777-4777-8777-777777777777', actor, {});

    expect(result.data[0]?.datasetModalities).toEqual(['text', 'image']);
    expect(result.data[0]?.datasetFieldSchema).toEqual([
      { name: 'question', type: 'string', role: 'text' },
      { name: 'screenshot', type: 'string', role: 'image_url' },
      { name: 'label', type: 'string', role: 'expected_output' },
    ]);
  });

  it('exposes outputSchema fields from prompt version on list items', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.listExperiments.mockResolvedValue([
      experimentRow({
        promptOutputSchema: {
          fields: [
            { key: 'risk_level', value: '风险等级 high/medium/low', isJudgment: true },
            { key: 'reason', value: '判定原因', isJudgment: false },
          ],
        },
      }),
    ]);

    const result = await service.listExperiments('77777777-7777-4777-8777-777777777777', actor, {});

    expect(result.data[0]?.outputSchema).toEqual({
      fields: [
        { key: 'risk_level', value: '风险等级 high/medium/low', isJudgment: true },
        { key: 'reason', value: '判定原因', isJudgment: false },
      ],
    });
  });

  it('returns null outputSchema when prompt version has no output schema', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.listExperiments.mockResolvedValue([experimentRow({ promptOutputSchema: null })]);

    const result = await service.listExperiments('77777777-7777-4777-8777-777777777777', actor, {});

    expect(result.data[0]?.outputSchema).toBeNull();
  });

  it('returns null outputSchema when prompt version stores malformed schema', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.listExperiments.mockResolvedValue([experimentRow({ promptOutputSchema: 'broken-jsonb-value' as unknown })]);

    const result = await service.listExperiments('77777777-7777-4777-8777-777777777777', actor, {});

    expect(result.data[0]?.outputSchema).toBeNull();
  });

  it('falls back to ["text"] when datasetFieldSchema is null or malformed', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.listExperiments.mockResolvedValue([
      experimentRow({ datasetFieldSchema: null }),
      experimentRow({
        id: '88888888-8888-4888-8888-888888888888',
        datasetFieldSchema: 'broken-jsonb-value' as unknown,
      }),
    ]);

    const result = await service.listExperiments('77777777-7777-4777-8777-777777777777', actor, {});

    expect(result.data).toHaveLength(2);
    expect(result.data[0]?.datasetModalities).toEqual(['text']);
    expect(result.data[1]?.datasetModalities).toEqual(['text']);
    expect(result.data[0]?.datasetFieldSchema).toBeNull();
    expect(result.data[1]?.datasetFieldSchema).toBeNull();
  });

  it('overrides processedSamples / failedSamples / metrics with live aggregate for running detail', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById.mockResolvedValue(
      experimentRow({
        status: 'running',
        processedSamples: 420,
        failedSamples: 3,
        metrics: { accuracy: 0.5, inputTokens: 100, outputTokens: 10, costEstimate: 0.01 },
      }),
    );
    runResults.aggregateExperiment.mockResolvedValue([
      {
        decisionOutput: 'yes',
        expectedOutput: 'yes',
        judgmentStatus: 'correct',
        status: 'success',
        count: 9,
        inputTokens: 9000,
        outputTokens: 900,
        costEstimate: 0.09,
      },
      {
        decisionOutput: null,
        expectedOutput: 'yes',
        judgmentStatus: null,
        status: 'failed',
        count: 1,
        inputTokens: 1000,
        outputTokens: 0,
        costEstimate: 0.01,
      },
      {
        decisionOutput: null,
        expectedOutput: 'yes',
        judgmentStatus: 'parse_error',
        status: 'success',
        count: 2,
        inputTokens: 200,
        outputTokens: 10,
        costEstimate: 0.002,
      },
    ]);

    const result = await service.getExperiment(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      actor,
    );

    expect(runResults.aggregateExperiment).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    // failed = status failed + parse_error / judge_error
    expect(result.processedSamples).toBe(12);
    expect(result.failedSamples).toBe(3);
    expect(result.metrics?.inputTokens).toBe(10200);
    expect(result.metrics?.outputTokens).toBe(910);
    // The accuracy 0.5 in the row field must not be passed through (it is overwritten by the aggregated result)
    expect(result.metrics?.accuracy).not.toBe(0.5);
  });

  it('skips live aggregate for terminal experiment detail (reads snapshot fields directly)', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById.mockResolvedValue(
      experimentRow({
        status: 'success',
        processedSamples: 1200,
        failedSamples: 5,
        metrics: { accuracy: 0.93, inputTokens: 120000, outputTokens: 8000, costEstimate: 0.5 },
      }),
    );

    const result = await service.getExperiment(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      actor,
    );

    expect(runResults.aggregateExperiment).not.toHaveBeenCalled();
    expect(result.processedSamples).toBe(1200);
    expect(result.failedSamples).toBe(5);
    expect(result.metrics?.accuracy).toBe(0.93);
  });

  it('listExperiments aggregates only running rows in parallel and leaves terminal rows untouched', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.listExperiments.mockResolvedValue([
      experimentRow({
        id: '22222222-2222-4222-8222-222222222222',
        status: 'running',
        processedSamples: 0,
        failedSamples: 0,
        metrics: null,
      }),
      experimentRow({
        id: '66666666-6666-4666-8666-666666666666',
        status: 'success',
        processedSamples: 1200,
        failedSamples: 4,
        metrics: { accuracy: 0.9, inputTokens: 1000, outputTokens: 100, costEstimate: 0.01 },
      }),
    ]);
    runResults.aggregateExperiment.mockResolvedValue([
      {
        decisionOutput: 'yes',
        expectedOutput: 'yes',
        judgmentStatus: 'correct',
        status: 'success',
        count: 12,
        inputTokens: 1200,
        outputTokens: 120,
        costEstimate: 0.012,
      },
    ]);

    const result = await service.listExperiments('77777777-7777-4777-8777-777777777777', actor, {});

    // Only running rows trigger an extra call; success rows are read directly
    expect(runResults.aggregateExperiment).toHaveBeenCalledTimes(1);
    expect(runResults.aggregateExperiment).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');

    const running = result.data.find((item) => item.id === '22222222-2222-4222-8222-222222222222');
    const success = result.data.find((item) => item.id === '66666666-6666-4666-8666-666666666666');
    expect(running?.processedSamples).toBe(12);
    expect(running?.failedSamples).toBe(0);
    expect(running?.metrics?.inputTokens).toBe(1200);
    expect(success?.processedSamples).toBe(1200);
    expect(success?.metrics?.accuracy).toBe(0.9);
  });

  it('exports experiments as CSV', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.listExperiments.mockResolvedValue([experimentRow({ status: 'success' })]);

    const file = await service.exportExperiments('77777777-7777-4777-8777-777777777777', 'csv', actor);

    expect(file.fileName).toBe('experiments-77777777.csv');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.buffer.toString('utf8')).toContain('exp-2026-0518-sql-risk');
  });

  it('exports a single experiment package with summary CSV and selected run-result detail format', async () => {
    repo.findProjectAccess.mockResolvedValue(projectAccess());
    repo.findExperimentById.mockResolvedValue(experimentRow({ status: 'success' }));
    runResults.exportExperimentRunResults.mockResolvedValue({
      fileName: 'experiment-run-results.jsonl',
      contentType: 'application/x-ndjson; charset=utf-8',
      stream: Readable.from(['{"id":"rr-1"}\n']),
    });

    const file = await service.exportExperimentPackage(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      'jsonl',
      actor,
      {
        page: 1,
        pageSize: 20,
        sort: 'created_desc',
        status: undefined,
        judgmentStatus: undefined,
        isCorrect: undefined,
      },
    );
    const zip = await readBuffer(file.stream);
    const text = zip.toString('latin1');

    expect(file.fileName).toBe('experiment-exp-2026-0518-sql-risk-jsonl.zip');
    expect(file.contentType).toBe('application/zip');
    expect(text).toContain('summary.csv');
    expect(text).toContain('run-results.jsonl');
    expect(text).toContain('exp-2026-0518-sql-risk');
    expect(text).toContain('{"id":"rr-1"}');
    expect(runResults.exportExperimentRunResults).toHaveBeenCalledWith(
      '77777777-7777-4777-8777-777777777777',
      '22222222-2222-4222-8222-222222222222',
      actor,
      'jsonl',
      {
        page: 1,
        pageSize: 20,
        sort: 'created_desc',
        status: undefined,
        judgmentStatus: undefined,
        isCorrect: undefined,
      },
    );
  });
});
