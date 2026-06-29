import { randomUUID } from 'node:crypto';
import { schema, type DbClient } from '@proofhound/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { DatasetRepository } from '../../src/server/modules/dataset/dataset.repository';
import { PromptRepository } from '../../src/server/modules/prompt/prompt.repository';
import { LocalReleaseLineDeletionHook } from '../../src/server/modules/release-line/release-line-deletion.hook';
import { ReleaseLineRepository } from '../../src/server/modules/release-line/release-line.repository';
import { describeDbosIntegration } from './setup';

const {
  annotationTasks,
  annotations,
  datasets,
  experiments,
  models,
  optimizationRoundSteps,
  optimizations,
  productionReleaseEvents,
  projects,
  prompts,
  promptVersions,
  releaseLineEvents,
  releaseLines,
  releaseVersions,
  runResults,
} = schema;

interface DeletionGraph {
  projectId: string;
  datasetId: string;
  promptId: string;
  promptVersionId: string;
  experimentId: string;
  optimizationId: string;
  optimizationExperimentId: string;
  releaseLineId: string;
  releaseLineEventId: string;
  productionReleaseEventId: string;
  runResultIds: string[];
}

interface ReleaseLineDeletionGraph {
  projectId: string;
  promptId: string;
  promptVersionId: string;
  releaseLineId: string;
  releaseVersionIds: string[];
  releaseLineEventIds: string[];
  annotationTaskId: string;
  releaseRunResultId: string;
}

describeDbosIntegration('Resource deletion policy integration', (getCtx) => {
  it('prompt permanent delete cascades child runs and stops online releases', async () => {
    const ctx = getCtx();
    const graph = await seedDeletionGraph(ctx.db, ctx.testUserId, 'prompt-delete');
    const repository = new PromptRepository(ctx.db);

    try {
      const impact = await repository.listDeletionImpact({
        projectId: graph.projectId,
        promptId: graph.promptId,
        versionIds: [graph.promptVersionId],
        generatedOptimizationIds: [graph.optimizationId],
        includePromptShell: true,
      });
      expect(impact.releaseLines.map((row) => row.id)).toEqual([graph.releaseLineId]);
      expect(impact.releaseLines[0]?.id).not.toBe(graph.releaseLineEventId);

      await repository.hardDeletePrompt(graph.projectId, graph.promptId);

      await expectCount(ctx.db, prompts, prompts.id, [graph.promptId], 0);
      await expectCount(ctx.db, promptVersions, promptVersions.id, [graph.promptVersionId], 0);
      await expectCount(ctx.db, experiments, experiments.id, [graph.experimentId, graph.optimizationExperimentId], 0);
      await expectCount(ctx.db, optimizations, optimizations.id, [graph.optimizationId], 0);
      await expectCount(ctx.db, runResults, runResults.id, graph.runResultIds, 0);

      const releaseEvents = await ctx.db
        .select({
          status: releaseLineEvents.status,
          terminalReason: releaseLineEvents.terminalReason,
          sourceExperimentId: releaseLineEvents.sourceExperimentId,
        })
        .from(releaseLineEvents)
        .where(eq(releaseLineEvents.id, graph.releaseLineEventId));
      expect(releaseEvents[0]).toMatchObject({
        status: 'stopped',
        terminalReason: 'force_stopped',
        sourceExperimentId: null,
      });

      const releaseLineRows = await ctx.db
        .select({ status: releaseLines.status })
        .from(releaseLines)
        .where(eq(releaseLines.id, graph.releaseLineId));
      expect(releaseLineRows[0]?.status).toBe('stopped');

      const legacyReleaseEvents = await ctx.db
        .select({
          status: productionReleaseEvents.status,
          stopReason: productionReleaseEvents.stopReason,
          sourceExperimentId: productionReleaseEvents.sourceExperimentId,
        })
        .from(productionReleaseEvents)
        .where(eq(productionReleaseEvents.id, graph.productionReleaseEventId));
      expect(legacyReleaseEvents[0]).toMatchObject({
        status: 'stopped',
        stopReason: 'force_stopped',
        sourceExperimentId: null,
      });

      await expectCount(ctx.db, datasets, datasets.id, [graph.datasetId], 1);
    } finally {
      await cleanupProject(ctx.db, graph.projectId);
    }
  });

  it('dataset permanent delete reports impact and removes dependent experiments and optimizations', async () => {
    const ctx = getCtx();
    const graph = await seedDeletionGraph(ctx.db, ctx.testUserId, 'dataset-delete');
    const repository = new DatasetRepository(ctx.db);

    try {
      const impact = await repository.listDeletionImpact(graph.projectId, graph.datasetId);
      expect(impact.experiments.map((row) => row.id).sort()).toEqual(
        [graph.experimentId, graph.optimizationExperimentId].sort(),
      );
      expect(impact.optimizations.map((row) => row.id)).toEqual([graph.optimizationId]);

      await repository.hardDeleteDataset(graph.projectId, graph.datasetId);

      await expectCount(ctx.db, datasets, datasets.id, [graph.datasetId], 0);
      await expectCount(ctx.db, experiments, experiments.id, [graph.experimentId, graph.optimizationExperimentId], 0);
      await expectCount(ctx.db, optimizations, optimizations.id, [graph.optimizationId], 0);
      await expectCount(ctx.db, runResults, runResults.id, graph.runResultIds, 0);

      const promptRows = await ctx.db
        .select({ defaultDatasetId: prompts.defaultDatasetId })
        .from(prompts)
        .where(eq(prompts.id, graph.promptId));
      expect(promptRows[0]?.defaultDatasetId).toBeNull();

      const releaseEvents = await ctx.db
        .select({
          status: releaseLineEvents.status,
          sourceExperimentId: releaseLineEvents.sourceExperimentId,
        })
        .from(releaseLineEvents)
        .where(eq(releaseLineEvents.id, graph.releaseLineEventId));
      expect(releaseEvents[0]).toMatchObject({ status: 'running', sourceExperimentId: null });

      const legacyReleaseEvents = await ctx.db
        .select({
          status: productionReleaseEvents.status,
          sourceExperimentId: productionReleaseEvents.sourceExperimentId,
        })
        .from(productionReleaseEvents)
        .where(eq(productionReleaseEvents.id, graph.productionReleaseEventId));
      expect(legacyReleaseEvents[0]).toMatchObject({ status: 'running', sourceExperimentId: null });
    } finally {
      await cleanupProject(ctx.db, graph.projectId);
    }
  });

  it('release line permanent delete reports versions, events, run results and annotation tasks', async () => {
    const ctx = getCtx();
    const graph = await seedReleaseLineDeletionGraph(ctx.db, ctx.testUserId);
    const repository = new ReleaseLineRepository(ctx.db);
    const deletionHook = new LocalReleaseLineDeletionHook(repository);

    try {
      const impact = await deletionHook.prepareReleaseLineDeletion({
        projectId: graph.projectId,
        releaseLineId: graph.releaseLineId,
      });
      // total = events(2) + versions(2) + annotationTasks(1) + runResults(1); see per-field asserts below
      expect(impact).toMatchObject({
        releaseLineId: graph.releaseLineId,
        runResults: 1,
        total: 6,
      });
      expect(impact?.versions.map((row) => row.id).sort()).toEqual([...graph.releaseVersionIds].sort());
      expect(impact?.events.map((row) => row.id).sort()).toEqual([...graph.releaseLineEventIds].sort());
      expect(impact?.annotationTasks.map((row) => row.id)).toEqual([graph.annotationTaskId]);

      await repository.hardDeleteLine(graph.projectId, graph.releaseLineId);

      await expectCount(ctx.db, releaseLines, releaseLines.id, [graph.releaseLineId], 0);
      await expectCount(ctx.db, releaseVersions, releaseVersions.id, graph.releaseVersionIds, 0);
      await expectCount(ctx.db, releaseLineEvents, releaseLineEvents.id, graph.releaseLineEventIds, 0);
      await expectCount(ctx.db, annotationTasks, annotationTasks.id, [graph.annotationTaskId], 0);
      await expectCount(ctx.db, runResults, runResults.id, [graph.releaseRunResultId], 0);

      const annotationRows = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(annotations)
        .where(eq(annotations.taskId, graph.annotationTaskId));
      expect(Number(annotationRows[0]?.count ?? 0)).toBe(0);

      const promptRows = await ctx.db
        .select({ currentOnlineVersionId: prompts.currentOnlineVersionId })
        .from(prompts)
        .where(eq(prompts.id, graph.promptId));
      expect(promptRows[0]?.currentOnlineVersionId).toBeNull();
    } finally {
      await cleanupProject(ctx.db, graph.projectId);
    }
  });
});

async function seedReleaseLineDeletionGraph(db: DbClient, testUserId: string): Promise<ReleaseLineDeletionGraph> {
  const suffix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const promptId = randomUUID();
  const promptVersionId = randomUUID();
  const modelId = randomUUID();
  const releaseLineId = randomUUID();
  const productionVersionId = randomUUID();
  const candidateVersionId = randomUUID();
  const productionEventId = randomUUID();
  const canaryEventId = randomUUID();
  const annotationTaskId = randomUUID();

  await db.insert(projects).values({
    id: projectId,
    name: `dbos-test-release-delete-${suffix}-project`,
    type: 'classification',
    status: 'active',
    createdBy: testUserId,
  });
  await db.insert(models).values({
    id: modelId,
    projectId,
    name: `dbos-test-release-delete-${suffix}-model`,
    providerType: 'openai',
    providerModelId: 'mock-model',
    endpoint: 'http://mock.invalid',
    apiKeyEncrypted: 'mock-encrypted-key',
    createdBy: testUserId,
  });
  await db.insert(prompts).values({
    id: promptId,
    projectId,
    name: `dbos-test-release-delete-${suffix}-prompt`,
    currentOnlineVersionId: promptVersionId,
    createdBy: testUserId,
  });
  await db.insert(promptVersions).values({
    id: promptVersionId,
    promptId,
    versionNumber: 1,
    body: 'Classify {{text}}',
    variables: [{ name: 'text', type: 'text', required: true }],
    outputSchema: { fields: [{ key: 'decision', isJudgment: true, value: 'A | B' }] },
    judgmentRules: { ruleName: 'exact_match', expectedField: 'expected' },
    isFrozen: true,
    frozenAt: new Date(),
    createdBy: testUserId,
  });
  await db.insert(releaseLines).values({
    id: releaseLineId,
    projectId,
    name: `dbos-test-release-delete-${suffix}-line`,
    promptId,
    promptName: `dbos-test-release-delete-${suffix}-prompt`,
    status: 'running',
    currentProductionEventId: productionEventId,
    activeCanaryEventId: canaryEventId,
    createdBy: testUserId,
  });
  await db.insert(releaseVersions).values([
    {
      id: productionVersionId,
      projectId,
      releaseLineId,
      kind: 'production',
      productionVersionNumber: 1,
      targetProductionVersionNumber: 1,
      promptId,
      promptName: `dbos-test-release-delete-${suffix}-prompt`,
      promptVersionId,
      promptVersionNumber: 1,
      modelId,
      createdBy: testUserId,
    },
    {
      id: candidateVersionId,
      projectId,
      releaseLineId,
      kind: 'candidate',
      targetProductionVersionNumber: 2,
      candidateNumber: 1,
      promptId,
      promptName: `dbos-test-release-delete-${suffix}-prompt`,
      promptVersionId,
      promptVersionNumber: 1,
      modelId,
      createdBy: testUserId,
    },
  ]);
  await db.insert(releaseLineEvents).values([
    {
      id: productionEventId,
      projectId,
      releaseLineId,
      releaseVersionId: productionVersionId,
      laneType: 'production',
      operation: 'create_production',
      status: 'running',
      promptId,
      promptName: `dbos-test-release-delete-${suffix}-prompt`,
      promptVersionId,
      promptVersionNumber: 1,
      modelId,
      submitReason: 'integration test',
      startedAt: new Date(),
      createdBy: testUserId,
    },
    {
      id: canaryEventId,
      projectId,
      releaseLineId,
      releaseVersionId: candidateVersionId,
      laneType: 'canary',
      operation: 'create_canary',
      status: 'running',
      promptId,
      promptName: `dbos-test-release-delete-${suffix}-prompt`,
      promptVersionId,
      promptVersionNumber: 1,
      modelId,
      trafficMode: 'split',
      trafficRatio: '0.2500',
      externalIdField: 'id',
      submitReason: 'integration test',
      startedAt: new Date(),
      createdBy: testUserId,
    },
  ]);
  await db.insert(annotationTasks).values({
    id: annotationTaskId,
    scope: 'all',
    releaseLineEventId: canaryEventId,
    releaseVersionId: candidateVersionId,
    releaseVersionScope: 'exact',
    name: `dbos-test-release-delete-${suffix}-annotation`,
    annotationSchema: { type: 'classification', options: ['A', 'B'] },
    totalSampled: 1,
    createdBy: testUserId,
  });

  const releaseRunResultId = await seedReleaseRunResult(db, {
    projectId,
    sourceId: canaryEventId,
    releaseVersionId: candidateVersionId,
    promptVersionId,
    modelId,
  });
  const [releaseRunResult] = await db
    .select({ id: runResults.id, createdAt: runResults.createdAt })
    .from(runResults)
    .where(eq(runResults.id, releaseRunResultId))
    .limit(1);
  await db.insert(annotations).values({
    runResultId: releaseRunResult!.id,
    runResultCreatedAt: releaseRunResult!.createdAt,
    taskId: annotationTaskId,
    fields: { expected_output: 'A' },
    isCorrect: true,
  });

  return {
    projectId,
    promptId,
    promptVersionId,
    releaseLineId,
    releaseVersionIds: [productionVersionId, candidateVersionId],
    releaseLineEventIds: [productionEventId, canaryEventId],
    annotationTaskId,
    releaseRunResultId,
  };
}

async function seedDeletionGraph(db: DbClient, testUserId: string, label: string): Promise<DeletionGraph> {
  const suffix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const datasetId = randomUUID();
  const promptId = randomUUID();
  const promptVersionId = randomUUID();
  const modelId = randomUUID();
  const experimentId = randomUUID();
  const optimizationId = randomUUID();
  const optimizationExperimentId = randomUUID();
  const releaseLineId = randomUUID();
  const releaseLineEventId = randomUUID();
  const productionReleaseEventId = randomUUID();

  await db.insert(projects).values({
    id: projectId,
    name: `dbos-test-${label}-${suffix}-project`,
    type: 'classification',
    status: 'active',
    createdBy: testUserId,
  });
  await db.insert(models).values({
    id: modelId,
    projectId,
    name: `dbos-test-${label}-${suffix}-model`,
    providerType: 'openai',
    providerModelId: 'mock-model',
    endpoint: 'http://mock.invalid',
    apiKeyEncrypted: 'mock-encrypted-key',
    createdBy: testUserId,
  });
  await db.insert(datasets).values({
    id: datasetId,
    projectId,
    name: `dbos-test-${label}-${suffix}-dataset`,
    sampleCount: 1,
    fieldSchema: [{ key: 'text', role: 'input', type: 'text' }],
    createdBy: testUserId,
  });
  await db.insert(prompts).values({
    id: promptId,
    projectId,
    name: `dbos-test-${label}-${suffix}-prompt`,
    defaultDatasetId: datasetId,
    createdBy: testUserId,
  });
  await db.insert(promptVersions).values({
    id: promptVersionId,
    promptId,
    versionNumber: 1,
    body: 'Classify {{text}}',
    variables: [{ name: 'text', type: 'text', required: true }],
    outputSchema: { fields: [{ key: 'decision', isJudgment: true, value: 'A | B' }] },
    judgmentRules: { ruleName: 'exact_match', expectedField: 'expected' },
    isFrozen: true,
    frozenAt: new Date(),
    createdBy: testUserId,
  });
  await db.insert(experiments).values({
    id: experimentId,
    projectId,
    name: `dbos-test-${label}-${suffix}-experiment`,
    promptVersionId,
    datasetId,
    modelId,
    status: 'success',
    totalSamples: 1,
    processedSamples: 1,
    createdBy: testUserId,
  });
  await db.insert(optimizations).values({
    id: optimizationId,
    projectId,
    name: `dbos-test-${label}-${suffix}-optimization`,
    strategy: 'error_pattern_analysis',
    startingMode: 'from_prompt_version',
    sourceExperimentId: experimentId,
    promptId,
    baseVersionId: promptVersionId,
    datasetId,
    experimentModelId: modelId,
    analysisModelId: modelId,
    goals: [{ metric: 'accuracy', comparator: 'gte', target: 0.9, scope: 'overall' }],
    fieldWhitelist: { inputFields: ['text'], metaFields: [] },
    status: 'success',
    createdBy: testUserId,
  });
  await db.insert(experiments).values({
    id: optimizationExperimentId,
    projectId,
    name: `dbos-test-${label}-${suffix}-optimization-experiment`,
    promptVersionId,
    datasetId,
    modelId,
    optimizationId,
    roundIndex: 1,
    status: 'success',
    totalSamples: 1,
    processedSamples: 1,
    createdBy: testUserId,
  });
  await db.insert(optimizationRoundSteps).values({
    optimizationId,
    roundIndex: 1,
    step: 'experiment',
    status: 'success',
    experimentId: optimizationExperimentId,
  });

  const runResultIds = [
    await seedRunResult(db, { projectId, source: 'experiment', sourceId: experimentId, promptVersionId, modelId }),
    await seedRunResult(db, {
      projectId,
      source: 'experiment',
      sourceId: optimizationExperimentId,
      promptVersionId,
      modelId,
    }),
    await seedRunResult(db, {
      projectId,
      source: 'optimization_analysis',
      sourceId: optimizationId,
      promptVersionId,
      modelId,
    }),
    await seedRunResult(db, {
      projectId,
      source: 'optimization_generate',
      sourceId: optimizationId,
      promptVersionId,
      modelId,
    }),
  ];

  const annotatedRunResult = await db
    .select({ id: runResults.id, createdAt: runResults.createdAt })
    .from(runResults)
    .where(eq(runResults.id, runResultIds[0]!))
    .limit(1);
  await db.insert(annotations).values({
    runResultId: annotatedRunResult[0]!.id,
    runResultCreatedAt: annotatedRunResult[0]!.createdAt,
    fields: { decision: 'A' },
    isCorrect: true,
  });

  await db.insert(releaseLines).values({
    id: releaseLineId,
    projectId,
    name: `dbos-test-${label}-${suffix}-release-line`,
    promptId,
    promptName: `dbos-test-${label}-${suffix}-prompt`,
    status: 'running',
    createdBy: testUserId,
  });
  await db.insert(releaseLineEvents).values({
    id: releaseLineEventId,
    projectId,
    releaseLineId,
    laneType: 'production',
    operation: 'create_production_from_experiment',
    status: 'running',
    promptId,
    promptName: `dbos-test-${label}-${suffix}-prompt`,
    promptVersionId,
    promptVersionNumber: 1,
    modelId,
    sourceExperimentId: experimentId,
    submitReason: 'integration test',
    startedAt: new Date(),
    createdBy: testUserId,
  });
  await db.insert(productionReleaseEvents).values({
    id: productionReleaseEventId,
    projectId,
    promptId,
    eventType: 'from_experiment',
    promptVersionId,
    modelId,
    runConfig: {},
    variableMapping: {},
    status: 'running',
    createdBy: testUserId,
    submitReason: 'integration test',
    sourceExperimentId: experimentId,
    startedAt: new Date(),
  });

  return {
    projectId,
    datasetId,
    promptId,
    promptVersionId,
    experimentId,
    optimizationId,
    optimizationExperimentId,
    releaseLineId,
    releaseLineEventId,
    productionReleaseEventId,
    runResultIds,
  };
}

async function seedRunResult(
  db: DbClient,
  input: {
    projectId: string;
    source: 'experiment' | 'optimization_analysis' | 'optimization_generate';
    sourceId: string;
    promptVersionId: string;
    modelId: string;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(runResults).values({
    id,
    projectId: input.projectId,
    source: input.source,
    sourceId: input.sourceId,
    promptVersionId: input.promptVersionId,
    modelId: input.modelId,
    renderedPrompt: { messages: [{ role: 'user', content: 'test' }] },
    parsedOutput: { decision: 'A' },
    status: 'success',
  });
  return id;
}

async function seedReleaseRunResult(
  db: DbClient,
  input: {
    projectId: string;
    sourceId: string;
    releaseVersionId: string;
    promptVersionId: string;
    modelId: string;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(runResults).values({
    id,
    projectId: input.projectId,
    source: 'release',
    sourceId: input.sourceId,
    releaseVersionId: input.releaseVersionId,
    promptVersionId: input.promptVersionId,
    modelId: input.modelId,
    renderedPrompt: { messages: [{ role: 'user', content: 'release traffic' }] },
    inputVariables: { id: 'case-1', text: 'A' },
    parsedOutput: { decision: 'A' },
    decisionOutput: 'A',
    status: 'success',
  });
  return id;
}

async function expectCount<TTable, TColumn>(
  db: DbClient,
  table: TTable,
  column: TColumn,
  ids: string[],
  expected: number,
): Promise<void> {
  const rows = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table as never)
    .where(inArray(column as never, ids))) as Array<{ count: number }>;
  expect(Number(rows[0]?.count ?? 0)).toBe(expected);
}

// Several tables reference ph_assets.models (and other leaf assets) with NO ON DELETE action,
// so the projects-level cascade hits those model_id FKs in arbitrary order and fails. Delete the
// project's rows in reverse-FK-dependency order first, then delete the project (which cascades the
// leaf assets prompts / prompt_versions / datasets / models). Each statement is independent and
// scoped by project, so a test whose seed only partially succeeded still cleans up.
async function cleanupProject(db: DbClient, projectId: string): Promise<void> {
  const pid = sql`${projectId}::uuid`;

  // 1. annotations — no project_id; reachable via run_results of the project OR annotation_tasks
  //    linked to the project's release rows.
  await db.execute(sql`
    DELETE FROM ph_runs.annotations a
    WHERE a.run_result_id IN (SELECT rr.id FROM ph_runs.run_results rr WHERE rr.project_id = ${pid})
       OR a.task_id IN (
         SELECT t.id FROM ph_releases.annotation_tasks t
         WHERE t.release_line_event_id IN (SELECT e.id FROM ph_releases.release_line_events e WHERE e.project_id = ${pid})
            OR t.release_version_id IN (SELECT v.id FROM ph_releases.release_versions v WHERE v.project_id = ${pid})
            OR t.production_release_event_id IN (SELECT p.id FROM ph_releases.production_release_events p WHERE p.project_id = ${pid})
       )
  `);

  // 2. annotation_tasks — no project_id; reachable via the project's release rows.
  await db.execute(sql`
    DELETE FROM ph_releases.annotation_tasks t
    WHERE t.release_line_event_id IN (SELECT e.id FROM ph_releases.release_line_events e WHERE e.project_id = ${pid})
       OR t.release_version_id IN (SELECT v.id FROM ph_releases.release_versions v WHERE v.project_id = ${pid})
       OR t.production_release_event_id IN (SELECT p.id FROM ph_releases.production_release_events p WHERE p.project_id = ${pid})
  `);

  // 3. run_results — has project_id (references release_versions / experiments / models with no action).
  await db.execute(sql`DELETE FROM ph_runs.run_results WHERE project_id = ${pid}`);

  // 4. release_line_events — has project_id (references models / experiments / release_versions with no action).
  await db.execute(sql`DELETE FROM ph_releases.release_line_events WHERE project_id = ${pid}`);

  // 5. production_release_events — has project_id (references models / experiments with no action).
  await db.execute(sql`DELETE FROM ph_releases.production_release_events WHERE project_id = ${pid}`);

  // 6. release_versions — has project_id (references models with no action).
  await db.execute(sql`DELETE FROM ph_releases.release_versions WHERE project_id = ${pid}`);

  // 7. release_lines — has project_id (references models implicitly via children, already cleared above).
  await db.execute(sql`DELETE FROM ph_releases.release_lines WHERE project_id = ${pid}`);

  // 8. optimization_round_steps — no project_id; reachable via optimizations of the project.
  await db.execute(sql`
    DELETE FROM ph_runs.optimization_round_steps s
    WHERE s.optimization_id IN (SELECT o.id FROM ph_runs.optimizations o WHERE o.project_id = ${pid})
  `);

  // 9. experiments — has project_id; optimizations reference experiments (no action), so delete
  //    optimizations first (step 10). experiments.optimization_id -> optimizations.id is SET NULL,
  //    so optimizations can be deleted before experiments.
  // 10. optimizations — has project_id (references experiments / models with no action).
  await db.execute(sql`DELETE FROM ph_runs.optimizations WHERE project_id = ${pid}`);
  await db.execute(sql`DELETE FROM ph_runs.experiments WHERE project_id = ${pid}`);

  // 11. project — cascades the remaining leaf assets prompts / prompt_versions / datasets / models.
  await db.delete(projects).where(eq(projects.id, projectId));
}
