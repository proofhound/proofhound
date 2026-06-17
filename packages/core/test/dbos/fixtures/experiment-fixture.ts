// Integration test fixture factory: inserts a minimal runnable experiment context
// (model + dataset + dataset_samples + prompt + prompt_version + experiment)

import { randomUUID } from 'node:crypto';
import { schema, type DbClient } from '@proofhound/db';
import { createLogger } from '@proofhound/logger';

const { models, datasets, datasetSamples, experiments, projects, prompts, promptVersions } = schema;
const logger = createLogger('dbos-test.fixture', { service: 'integration-test' });

export interface SeedExperimentOptions {
  /** default 3 */
  sampleCount?: number;
  /** default true. set to false to trigger prompt_version_not_frozen */
  isFrozen?: boolean;
  /** batchSize written to experiments.run_config */
  batchSize?: number;
  /** expected_output value per sample (used for metrics). length should equal sampleCount */
  expectedValues?: string[];
}

export interface SeededExperiment {
  projectId: string;
  modelId: string;
  datasetId: string;
  promptId: string;
  promptVersionId: string;
  experimentId: string;
  sampleIds: string[];
}

export async function seedExperiment(
  db: DbClient,
  testUserId: string,
  opts: SeedExperimentOptions = {},
): Promise<SeededExperiment> {
  const sampleCount = opts.sampleCount ?? 3;
  const isFrozen = opts.isFrozen ?? true;
  const expectedValues =
    opts.expectedValues ?? Array.from({ length: sampleCount }, () => 'A');

  const projectId = randomUUID();
  const prefix = `dbos-test-${projectId.slice(0, 8)}`;

  await db.insert(projects).values({
    id: projectId,
    name: `${prefix}-project`,
    type: 'classification',
    status: 'active',
    createdBy: testUserId,
  });

  const modelId = randomUUID();
  await db.insert(models).values({
    id: modelId,
    projectId,
    name: `${prefix}-model`,
    providerType: 'openai',
    providerModelId: 'mock-model-1',
    endpoint: 'http://mock.invalid',
    apiKeyEncrypted: 'mock-encrypted-key',
    createdBy: testUserId,
  });

  const datasetId = randomUUID();
  await db.insert(datasets).values({
    id: datasetId,
    projectId,
    name: `${prefix}-dataset`,
    sampleCount,
    fieldSchema: [
      { key: 'text', role: 'input', type: 'text' },
      { key: 'expected_output', role: 'expected_output', type: 'text' },
    ],
    createdBy: testUserId,
  });

  const sampleIds: string[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const sampleId = randomUUID();
    sampleIds.push(sampleId);
    await db.insert(datasetSamples).values({
      id: sampleId,
      datasetId,
      data: { text: `sample ${i + 1}`, expected_output: expectedValues[i] ?? 'A' },
    });
  }

  const promptId = randomUUID();
  await db.insert(prompts).values({
    id: promptId,
    projectId,
    name: `${prefix}-prompt`,
    createdBy: testUserId,
  });

  const promptVersionId = randomUUID();
  await db.insert(promptVersions).values({
    id: promptVersionId,
    promptId,
    versionNumber: 1,
    body: 'classify: {{text}}',
    variables: [{ name: 'text', type: 'text', required: true, datasetField: 'text' }],
    outputSchema: { fields: [{ key: 'expected_output', value: 'A or B', isJudgment: true }] },
    judgmentRules: { expected_field: 'expected_output' },
    isFrozen,
    frozenAt: isFrozen ? new Date() : null,
    createdBy: testUserId,
  });

  const experimentId = randomUUID();
  const runConfig: Record<string, unknown> = {};
  if (opts.batchSize !== undefined) runConfig['batchSize'] = opts.batchSize;
  await db.insert(experiments).values({
    id: experimentId,
    projectId,
    name: `${prefix}-experiment`,
    promptVersionId,
    datasetId,
    modelId,
    // experiments have no 'pending' state — submission enters 'running' directly
    // (experiments_status_check allows running/success/failed/stopped/cancelled).
    status: 'running',
    totalSamples: sampleCount,
    runConfig,
    createdBy: testUserId,
  });

  logger.debug(
    { experimentId, projectId, sampleCount, isFrozen, batchSize: opts.batchSize ?? null },
    'fixture_seed_experiment_done',
  );

  return { projectId, modelId, datasetId, promptId, promptVersionId, experimentId, sampleIds };
}
