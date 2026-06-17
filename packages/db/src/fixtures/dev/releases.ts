import { DEV_CONNECTORS } from './connectors';
import { DEV_EXPERIMENT_DATASETS } from './experiments';
import { DEV_MODELS } from './models';
import { DEV_PROMPTS } from './prompts';

const LOCAL_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

function fixtureId(sequence: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${String(sequence).padStart(12, '0')}`;
}

const RELEASE_LINE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const VERSION_CANDIDATE_01_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000011';
const VERSION_CANDIDATE_02_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000012';
const VERSION_PRODUCTION_1_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000013';
const VERSION_CANDIDATE_11_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000014';
const EVENT_CANDIDATE_01_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000021';
const EVENT_CANDIDATE_02_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000022';
const EVENT_PRODUCTION_1_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000023';
const EVENT_CANDIDATE_11_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000024';
const EVENT_PRODUCTION_1_CONFIG_ID = fixtureId(25);
const ANNOTATION_TASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000041';
const GENERATED_PRODUCTION_NUMBERS = [3, 4, 5, 6, 7, 8, 9, 10] as const;
const ACTIVE_CANDIDATE_TARGET_PRODUCTION_NUMBER = 11;

function requireFixture<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`Missing dev release fixture dependency: ${label}`);
  return value;
}

const prompt = requireFixture(
  DEV_PROMPTS.find((item) => item.id === '246bc6d3-8ac9-43d5-a055-f9098884e227'),
  'emotion category prompt',
);
const promptV2 = requireFixture(
  prompt.versions.find((version) => version.id === 'c77ce1bc-160c-5a51-84ed-0334233803fd'),
  'emotion category prompt v2',
);
const promptV3 = requireFixture(
  prompt.versions.find((version) => version.id === '8eab5ca8-08f2-5bdc-b69e-bedf4c6f188e'),
  'emotion category prompt v3',
);
const ernie5 = requireFixture(
  DEV_MODELS.find((model) => model.id === '826d092f-0afa-4e01-b223-d608d1db519d'),
  'ERNIE 5.0 model',
);
const sonnet = requireFixture(
  DEV_MODELS.find((model) => model.id === '45be9255-88d5-4e32-b650-ba624f33c8f0'),
  'Claude Sonnet model',
);
const inputConnector = requireFixture(
  DEV_CONNECTORS.find((connector) => connector.id === 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005'),
  'sync webhook input connector',
);
const outputConnectors = [
  requireFixture(
    DEV_CONNECTORS.find((connector) => connector.id === 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'),
    'Redis output connector',
  ),
  requireFixture(
    DEV_CONNECTORS.find((connector) => connector.id === 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004'),
    'Kafka output connector',
  ),
];
const yelpDataset = requireFixture(
  DEV_EXPERIMENT_DATASETS.find((dataset) => dataset.id === 'db945aa9-fe6e-4591-9b99-42f0b4dd567e'),
  'Yelp polarity dataset',
);

type DevReleaseVersionKind = 'candidate' | 'production';
type DevReleaseLineStatus = 'running' | 'stopped' | 'archived';
type DevReleaseLane = 'canary' | 'production';
type DevReleaseEventOperation =
  | 'create_production'
  | 'create_production_from_experiment'
  | 'create_canary'
  | 'traffic_updated'
  | 'mode_updated'
  | 'config_changed'
  | 'stop_lane'
  | 'resume_lane'
  | 'cancel_canary'
  | 'promote_canary'
  | 'rollback'
  | 'force_stop'
  | 'archive_line';
type DevReleaseEventStatus = 'running' | 'stopped' | 'completed' | 'failed' | 'cancelled' | 'archived';
type DevReleaseTerminalReason =
  | 'replaced'
  | 'rolled_back'
  | 'force_stopped'
  | 'promoted'
  | 'cancelled'
  | 'archived'
  | 'error';

export type DevReleaseLineFixture = {
  id: string;
  name: string;
  description: string | null;
  promptId: string;
  promptName: string;
  promptSnapshot: Record<string, unknown>;
  inputConnectorId: string;
  inputConnectorName: string;
  inputConnectorType: string;
  inputConnectorSnapshot: Record<string, unknown>;
  status: DevReleaseLineStatus;
  currentProductionEventId: string | null;
  activeCanaryEventId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DevReleaseVersionFixture = {
  id: string;
  releaseLineId: string;
  kind: DevReleaseVersionKind;
  productionVersionNumber: number | null;
  targetProductionVersionNumber: number;
  candidateNumber: number | null;
  promotedFromReleaseVersionId: string | null;
  promptId: string;
  promptName: string;
  promptVersionId: string;
  promptVersionNumber: number;
  promptSnapshot: Record<string, unknown>;
  promptVersionSnapshot: Record<string, unknown>;
  modelId: string;
  modelSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type DevReleaseEventFixture = {
  id: string;
  releaseLineId: string;
  laneType: DevReleaseLane;
  operation: DevReleaseEventOperation;
  status: DevReleaseEventStatus;
  terminalReason: DevReleaseTerminalReason | null;
  sourceEventId: string | null;
  supersedesEventId: string | null;
  rollbackTargetEventId: string | null;
  releaseVersionId: string;
  promptId: string;
  promptName: string;
  promptVersionId: string;
  promptVersionNumber: number;
  promptSnapshot: Record<string, unknown>;
  promptVersionSnapshot: Record<string, unknown>;
  modelId: string;
  modelSnapshot: Record<string, unknown>;
  inputConnectorId: string;
  inputConnectorSnapshot: Record<string, unknown>;
  outputConnectorIds: string[];
  outputConnectorSnapshots: Record<string, unknown>[];
  trafficMode: 'split' | 'dual_run' | null;
  trafficRatio: string | null;
  runConfig: Record<string, unknown>;
  variableMapping: Record<string, unknown>;
  outputMapping: Array<Record<string, unknown>>;
  filterRules: Record<string, unknown> | null;
  recordMode: 'all' | 'selected_categories' | 'correct_only';
  recordCategories: string[];
  externalIdField: string | null;
  retentionDays: number | null;
  sourceExperimentId: string | null;
  submitReason: string;
  metrics: Record<string, unknown> | null;
  totalReceived: number;
  totalProcessed: number;
  totalFiltered: number;
  totalCorrect: number;
  totalErrors: number;
  controlState: string | null;
  controlStatePayload: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DevReleaseRunResultFixture = {
  id: string;
  sourceId: string;
  releaseVersionId: string;
  promptVersionId: string;
  modelId: string;
  sampleId: string;
  externalId: string | null;
  renderedPrompt: Record<string, unknown>;
  inputVariables: Record<string, unknown>;
  rawResponse: string;
  parsedOutput: Record<string, unknown>;
  decisionOutput: string;
  expectedOutput: string;
  isCorrect: boolean;
  judgmentStatus: 'correct' | 'incorrect' | 'parse_error' | 'judge_error' | null;
  status: 'running' | 'success' | 'failed';
  errorClass: string | null;
  errorMessage: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: string;
  createdAt: string;
};

export type DevReleaseAnnotationTaskFixture = {
  id: string;
  scope: 'canary' | 'online';
  releaseLineEventId: string;
  releaseVersionId: string;
  releaseVersionScope: 'exact' | 'journey';
  name: string;
  annotationSchema: Array<Record<string, unknown>>;
  samplingConfig: Record<string, unknown>;
  totalSampled: number;
  totalAnnotated: number;
  status: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
};

export type DevReleaseAnnotationFixture = {
  id: string;
  runResultId: string;
  runResultCreatedAt: string;
  taskId: string;
  isCorrect: boolean | null;
  fields: Record<string, unknown>;
  notes: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  lockHeartbeatAt: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const promptSnapshot = {
  id: prompt.id,
  name: prompt.name,
  defaultDatasetId: prompt.defaultDatasetId,
};

function promptVersionSnapshot(version: typeof promptV2): Record<string, unknown> {
  return {
    id: version.id,
    promptId: prompt.id,
    versionNumber: version.versionNumber,
    body: version.body,
    variables: version.variables,
    outputSchema: version.outputSchema,
    judgmentRules: version.judgmentRules,
    promptLanguage: version.promptLanguage,
  };
}

function modelSnapshot(model: typeof ernie5): Record<string, unknown> {
  return {
    id: model.id,
    name: model.name,
    providerType: model.providerType,
    providerModelId: model.providerModelId,
  };
}

function connectorType(connector: (typeof DEV_CONNECTORS)[number]): string {
  if (connector.kind.startsWith('redis-')) return 'redis';
  if (connector.kind.startsWith('kafka-')) return 'kafka';
  return 'webhook';
}

function connectorSnapshot(connector: (typeof DEV_CONNECTORS)[number]): Record<string, unknown> {
  return {
    id: connector.id,
    name: connector.name,
    type: connectorType(connector),
  };
}

const inputConnectorSnapshot = connectorSnapshot(inputConnector);
const outputConnectorIds = outputConnectors.map((connector) => connector.id);
const outputConnectorSnapshots = outputConnectors.map(connectorSnapshot);
const defaultRunConfig = {
  retries: 2,
  rpmLimit: 30,
  tpmLimit: 150000,
  concurrency: 12,
  temperature: 0,
  sampleTimeoutSeconds: 20,
};
const variableMapping = { id: 'sample_id', text: 'text' };
const outputMapping = [{ from: 'expected_output', to: 'decision' }];

type DevReleaseQualityMetricSet = {
  recall: number;
  precision: number;
  f1: number;
  accuracy: number;
  sampleCount: number;
};

function qualityScore(value: number): number {
  return Number(Math.max(0, Math.min(0.995, value)).toFixed(3));
}

function qualityF1(recall: number, precision: number): number {
  if (recall <= 0 || precision <= 0) return 0;
  return qualityScore((2 * recall * precision) / (recall + precision));
}

function qualityMetricSet(input: {
  recall: number;
  precision: number;
  accuracy: number;
  sampleCount: number;
}): DevReleaseQualityMetricSet {
  const recall = qualityScore(input.recall);
  const precision = qualityScore(input.precision);
  return {
    recall,
    precision,
    f1: qualityF1(recall, precision),
    accuracy: qualityScore(input.accuracy),
    sampleCount: Math.max(0, Math.round(input.sampleCount)),
  };
}

function releaseQuality(base: number, sampleCount: number): Record<string, unknown> {
  const positiveSampleCount = Math.round(sampleCount * 0.58);
  const negativeSampleCount = Math.max(0, sampleCount - positiveSampleCount);
  return {
    overall: qualityMetricSet({
      recall: base - 0.012,
      precision: base + 0.008,
      accuracy: base + 0.004,
      sampleCount,
    }),
    scopes: [
      {
        key: 'positive',
        label: 'positive',
        metrics: qualityMetricSet({
          recall: base + 0.026,
          precision: base - 0.006,
          accuracy: base + 0.018,
          sampleCount: positiveSampleCount,
        }),
      },
      {
        key: 'negative',
        label: 'negative',
        metrics: qualityMetricSet({
          recall: base - 0.046,
          precision: base + 0.026,
          accuracy: base - 0.014,
          sampleCount: negativeSampleCount,
        }),
      },
    ],
  };
}

function releaseTime(minutesAfterEight: number): string {
  return new Date(Date.UTC(2026, 4, 23, 8, minutesAfterEight, 0, 0)).toISOString();
}

function generatedCandidateVersionId(targetProductionNumber: number): string {
  return fixtureId(300 + targetProductionNumber);
}

function generatedProductionVersionId(productionNumber: number): string {
  return fixtureId(400 + productionNumber);
}

function generatedCandidateEventId(targetProductionNumber: number): string {
  return fixtureId(600 + targetProductionNumber * 10 + 1);
}

function generatedProductionEventId(productionNumber: number): string {
  return fixtureId(600 + productionNumber * 10 + 2);
}

function generatedConfigEventId(productionNumber: number): string {
  return fixtureId(600 + productionNumber * 10 + 3);
}

function tunedProductionRunConfig(productionNumber: number): Record<string, unknown> {
  return {
    ...defaultRunConfig,
    rpmLimit: 30 + productionNumber * 4,
    tpmLimit: 150000 + productionNumber * 6000,
    concurrency: 10 + (productionNumber % 5),
    temperature: Number((0.04 + (productionNumber % 4) * 0.03).toFixed(2)),
  };
}

function candidateRunConfig(targetProductionNumber: number): Record<string, unknown> {
  return {
    ...defaultRunConfig,
    rpmLimit: 18 + targetProductionNumber * 3,
    tpmLimit: 90000 + targetProductionNumber * 5000,
    concurrency: 6 + (targetProductionNumber % 4),
    temperature: Number((0.12 + (targetProductionNumber % 3) * 0.04).toFixed(2)),
  };
}

function releaseVersionFixture(input: {
  id: string;
  kind: DevReleaseVersionKind;
  productionVersionNumber: number | null;
  targetProductionVersionNumber: number;
  candidateNumber: number | null;
  promotedFromReleaseVersionId: string | null;
  promptVersion: typeof promptV2;
  model: typeof ernie5;
  createdAt: string;
  updatedAt: string;
}): DevReleaseVersionFixture {
  return {
    id: input.id,
    releaseLineId: RELEASE_LINE_ID,
    kind: input.kind,
    productionVersionNumber: input.productionVersionNumber,
    targetProductionVersionNumber: input.targetProductionVersionNumber,
    candidateNumber: input.candidateNumber,
    promotedFromReleaseVersionId: input.promotedFromReleaseVersionId,
    promptId: prompt.id,
    promptName: prompt.name,
    promptVersionId: input.promptVersion.id,
    promptVersionNumber: input.promptVersion.versionNumber,
    promptSnapshot,
    promptVersionSnapshot: promptVersionSnapshot(input.promptVersion),
    modelId: input.model.id,
    modelSnapshot: modelSnapshot(input.model),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

type GeneratedProductionPlan = {
  productionNumber: number;
  candidateVersionId: string;
  productionVersionId: string;
  candidateEventId: string;
  productionEventId: string;
  configEventId: string;
  previousProductionEventId: string;
  promptVersion: typeof promptV2;
  model: typeof ernie5;
  candidateCreatedAt: string;
  candidateUpdatedAt: string;
  productionCreatedAt: string;
  productionUpdatedAt: string;
  configCreatedAt: string;
  configUpdatedAt: string;
};

const production2Plan: GeneratedProductionPlan = {
  productionNumber: 2,
  candidateVersionId: VERSION_CANDIDATE_11_ID,
  productionVersionId: generatedProductionVersionId(2),
  candidateEventId: EVENT_CANDIDATE_11_ID,
  productionEventId: generatedProductionEventId(2),
  configEventId: generatedConfigEventId(2),
  previousProductionEventId: EVENT_PRODUCTION_1_CONFIG_ID,
  promptVersion: promptV3,
  model: sonnet,
  candidateCreatedAt: '2026-05-23T08:30:00.000Z',
  candidateUpdatedAt: '2026-05-23T08:44:00.000Z',
  productionCreatedAt: '2026-05-23T08:50:00.000Z',
  productionUpdatedAt: '2026-05-23T08:50:00.000Z',
  configCreatedAt: '2026-05-23T08:56:00.000Z',
  configUpdatedAt: '2026-05-23T09:04:00.000Z',
};

const generatedProductionPlans: GeneratedProductionPlan[] = [
  production2Plan,
  ...GENERATED_PRODUCTION_NUMBERS.map((productionNumber, index) => {
    const baseMinute = 70 + index * 18;
    const promptVersion = productionNumber % 2 === 0 ? promptV3 : promptV2;
    const model = productionNumber % 3 === 0 ? sonnet : ernie5;
    return {
      productionNumber,
      candidateVersionId: generatedCandidateVersionId(productionNumber),
      productionVersionId: generatedProductionVersionId(productionNumber),
      candidateEventId: generatedCandidateEventId(productionNumber),
      productionEventId: generatedProductionEventId(productionNumber),
      configEventId: generatedConfigEventId(productionNumber),
      previousProductionEventId: generatedConfigEventId(productionNumber - 1),
      promptVersion,
      model,
      candidateCreatedAt: releaseTime(baseMinute),
      candidateUpdatedAt: releaseTime(baseMinute + 8),
      productionCreatedAt: releaseTime(baseMinute + 12),
      productionUpdatedAt: releaseTime(baseMinute + 12),
      configCreatedAt: releaseTime(baseMinute + 15),
      configUpdatedAt: releaseTime(baseMinute + 17),
    };
  }),
];

const activeCandidatePlan = {
  targetProductionNumber: ACTIVE_CANDIDATE_TARGET_PRODUCTION_NUMBER,
  candidateVersionId: generatedCandidateVersionId(ACTIVE_CANDIDATE_TARGET_PRODUCTION_NUMBER),
  candidateEventId: generatedCandidateEventId(ACTIVE_CANDIDATE_TARGET_PRODUCTION_NUMBER),
  configEventId: generatedConfigEventId(ACTIVE_CANDIDATE_TARGET_PRODUCTION_NUMBER),
  previousProductionEventId: generatedConfigEventId(10),
  promptVersion: promptV3,
  model: sonnet,
  candidateCreatedAt: releaseTime(220),
  candidateUpdatedAt: releaseTime(228),
  configCreatedAt: releaseTime(234),
  configUpdatedAt: releaseTime(238),
};

export const DEV_RELEASE_LINES: DevReleaseLineFixture[] = [
  {
    id: RELEASE_LINE_ID,
    name: 'sentiment-classifier-live',
    description:
      'Dev release line showing enough production versions, canaries, and config changes to exercise history loading.',
    promptId: prompt.id,
    promptName: prompt.name,
    promptSnapshot,
    inputConnectorId: inputConnector.id,
    inputConnectorName: inputConnector.name,
    inputConnectorType: connectorType(inputConnector),
    inputConnectorSnapshot,
    status: 'running',
    currentProductionEventId: generatedConfigEventId(10),
    activeCanaryEventId: activeCandidatePlan.configEventId,
    createdAt: '2026-05-23T07:20:00.000Z',
    updatedAt: activeCandidatePlan.configUpdatedAt,
  },
];

export const DEV_RELEASE_VERSIONS: DevReleaseVersionFixture[] = [
  {
    id: VERSION_CANDIDATE_01_ID,
    releaseLineId: RELEASE_LINE_ID,
    kind: 'candidate',
    productionVersionNumber: null,
    targetProductionVersionNumber: 1,
    candidateNumber: 1,
    promotedFromReleaseVersionId: null,
    promptId: prompt.id,
    promptName: prompt.name,
    promptVersionId: promptV2.id,
    promptVersionNumber: promptV2.versionNumber,
    promptSnapshot,
    promptVersionSnapshot: promptVersionSnapshot(promptV2),
    modelId: ernie5.id,
    modelSnapshot: modelSnapshot(ernie5),
    createdAt: '2026-05-23T07:20:00.000Z',
    updatedAt: '2026-05-23T07:28:00.000Z',
  },
  {
    id: VERSION_CANDIDATE_02_ID,
    releaseLineId: RELEASE_LINE_ID,
    kind: 'candidate',
    productionVersionNumber: null,
    targetProductionVersionNumber: 1,
    candidateNumber: 2,
    promotedFromReleaseVersionId: null,
    promptId: prompt.id,
    promptName: prompt.name,
    promptVersionId: promptV3.id,
    promptVersionNumber: promptV3.versionNumber,
    promptSnapshot,
    promptVersionSnapshot: promptVersionSnapshot(promptV3),
    modelId: ernie5.id,
    modelSnapshot: modelSnapshot(ernie5),
    createdAt: '2026-05-23T07:35:00.000Z',
    updatedAt: '2026-05-23T07:48:00.000Z',
  },
  {
    id: VERSION_PRODUCTION_1_ID,
    releaseLineId: RELEASE_LINE_ID,
    kind: 'production',
    productionVersionNumber: 1,
    targetProductionVersionNumber: 1,
    candidateNumber: null,
    promotedFromReleaseVersionId: VERSION_CANDIDATE_02_ID,
    promptId: prompt.id,
    promptName: prompt.name,
    promptVersionId: promptV3.id,
    promptVersionNumber: promptV3.versionNumber,
    promptSnapshot,
    promptVersionSnapshot: promptVersionSnapshot(promptV3),
    modelId: ernie5.id,
    modelSnapshot: modelSnapshot(ernie5),
    createdAt: '2026-05-23T08:00:00.000Z',
    updatedAt: '2026-05-23T08:00:00.000Z',
  },
  {
    id: VERSION_CANDIDATE_11_ID,
    releaseLineId: RELEASE_LINE_ID,
    kind: 'candidate',
    productionVersionNumber: null,
    targetProductionVersionNumber: 2,
    candidateNumber: 1,
    promotedFromReleaseVersionId: null,
    promptId: prompt.id,
    promptName: prompt.name,
    promptVersionId: promptV3.id,
    promptVersionNumber: promptV3.versionNumber,
    promptSnapshot,
    promptVersionSnapshot: promptVersionSnapshot(promptV3),
    modelId: sonnet.id,
    modelSnapshot: modelSnapshot(sonnet),
    createdAt: '2026-05-23T08:30:00.000Z',
    updatedAt: production2Plan.candidateUpdatedAt,
  },
  releaseVersionFixture({
    id: production2Plan.productionVersionId,
    kind: 'production',
    productionVersionNumber: 2,
    targetProductionVersionNumber: 2,
    candidateNumber: null,
    promotedFromReleaseVersionId: VERSION_CANDIDATE_11_ID,
    promptVersion: promptV3,
    model: sonnet,
    createdAt: production2Plan.productionCreatedAt,
    updatedAt: production2Plan.configUpdatedAt,
  }),
  ...generatedProductionPlans.slice(1).flatMap((plan) => [
    releaseVersionFixture({
      id: plan.candidateVersionId,
      kind: 'candidate',
      productionVersionNumber: null,
      targetProductionVersionNumber: plan.productionNumber,
      candidateNumber: 1,
      promotedFromReleaseVersionId: null,
      promptVersion: plan.promptVersion,
      model: plan.model,
      createdAt: plan.candidateCreatedAt,
      updatedAt: plan.candidateUpdatedAt,
    }),
    releaseVersionFixture({
      id: plan.productionVersionId,
      kind: 'production',
      productionVersionNumber: plan.productionNumber,
      targetProductionVersionNumber: plan.productionNumber,
      candidateNumber: null,
      promotedFromReleaseVersionId: plan.candidateVersionId,
      promptVersion: plan.promptVersion,
      model: plan.model,
      createdAt: plan.productionCreatedAt,
      updatedAt: plan.configUpdatedAt,
    }),
  ]),
  releaseVersionFixture({
    id: activeCandidatePlan.candidateVersionId,
    kind: 'candidate',
    productionVersionNumber: null,
    targetProductionVersionNumber: activeCandidatePlan.targetProductionNumber,
    candidateNumber: 1,
    promotedFromReleaseVersionId: null,
    promptVersion: activeCandidatePlan.promptVersion,
    model: activeCandidatePlan.model,
    createdAt: activeCandidatePlan.candidateCreatedAt,
    updatedAt: activeCandidatePlan.configUpdatedAt,
  }),
];

type ReleaseEventInput = Omit<
  DevReleaseEventFixture,
  | 'releaseLineId'
  | 'promptId'
  | 'promptName'
  | 'promptSnapshot'
  | 'inputConnectorId'
  | 'inputConnectorSnapshot'
  | 'outputConnectorIds'
  | 'outputConnectorSnapshots'
  | 'runConfig'
  | 'variableMapping'
  | 'outputMapping'
  | 'filterRules'
  | 'recordMode'
  | 'recordCategories'
  | 'externalIdField'
  | 'retentionDays'
  | 'controlState'
  | 'controlStatePayload'
> &
  Partial<
    Pick<
      DevReleaseEventFixture,
      | 'runConfig'
      | 'variableMapping'
      | 'outputMapping'
      | 'filterRules'
      | 'recordMode'
      | 'recordCategories'
      | 'externalIdField'
      | 'retentionDays'
      | 'controlState'
      | 'controlStatePayload'
    >
  >;

function releaseEvent(input: ReleaseEventInput): DevReleaseEventFixture {
  return {
    releaseLineId: RELEASE_LINE_ID,
    promptId: prompt.id,
    promptName: prompt.name,
    promptSnapshot,
    inputConnectorId: inputConnector.id,
    inputConnectorSnapshot,
    outputConnectorIds,
    outputConnectorSnapshots,
    runConfig: defaultRunConfig,
    variableMapping,
    outputMapping,
    filterRules: null,
    recordMode: 'all',
    recordCategories: [],
    externalIdField: 'sample_id',
    retentionDays: 30,
    controlState: null,
    controlStatePayload: null,
    ...input,
  };
}

export const DEV_RELEASE_EVENTS: DevReleaseEventFixture[] = [
  releaseEvent({
    id: EVENT_CANDIDATE_01_ID,
    laneType: 'canary',
    operation: 'create_canary',
    status: 'completed',
    terminalReason: 'promoted',
    sourceEventId: null,
    supersedesEventId: null,
    rollbackTargetEventId: null,
    releaseVersionId: VERSION_CANDIDATE_01_ID,
    promptVersionId: promptV2.id,
    promptVersionNumber: promptV2.versionNumber,
    promptVersionSnapshot: promptVersionSnapshot(promptV2),
    modelId: ernie5.id,
    modelSnapshot: modelSnapshot(ernie5),
    trafficMode: 'split',
    trafficRatio: '0.1000',
    sourceExperimentId: 'ef6c9622-7fe1-455b-a4fd-85176f80bce5',
    submitReason: 'First candidate before v1; validate live traffic behavior at 10%.',
    metrics: { accuracy: 0.93, p50LatencyMs: 3100, quality: releaseQuality(0.765, 32) },
    totalReceived: 32,
    totalProcessed: 31,
    totalFiltered: 1,
    totalCorrect: 29,
    totalErrors: 1,
    startedAt: '2026-05-23T07:20:05.000Z',
    finishedAt: '2026-05-23T07:28:00.000Z',
    createdAt: '2026-05-23T07:20:00.000Z',
    updatedAt: '2026-05-23T07:28:00.000Z',
  }),
  releaseEvent({
    id: EVENT_CANDIDATE_02_ID,
    laneType: 'canary',
    operation: 'traffic_updated',
    status: 'completed',
    terminalReason: 'promoted',
    sourceEventId: EVENT_CANDIDATE_01_ID,
    supersedesEventId: EVENT_CANDIDATE_01_ID,
    rollbackTargetEventId: null,
    releaseVersionId: VERSION_CANDIDATE_02_ID,
    promptVersionId: promptV3.id,
    promptVersionNumber: promptV3.versionNumber,
    promptVersionSnapshot: promptVersionSnapshot(promptV3),
    modelId: ernie5.id,
    modelSnapshot: modelSnapshot(ernie5),
    trafficMode: 'split',
    trafficRatio: '0.2500',
    sourceExperimentId: '7c54873b-8d0a-5003-8cfb-26f8b8ba7096',
    submitReason: 'Second v1 candidate after optimization; widened traffic to 25%.',
    metrics: { accuracy: 0.96, p50LatencyMs: 2850, quality: releaseQuality(0.812, 64) },
    totalReceived: 64,
    totalProcessed: 63,
    totalFiltered: 1,
    totalCorrect: 60,
    totalErrors: 1,
    startedAt: '2026-05-23T07:35:05.000Z',
    finishedAt: '2026-05-23T07:48:00.000Z',
    createdAt: '2026-05-23T07:35:00.000Z',
    updatedAt: '2026-05-23T07:48:00.000Z',
  }),
  releaseEvent({
    id: EVENT_PRODUCTION_1_ID,
    laneType: 'production',
    operation: 'promote_canary',
    status: 'completed',
    terminalReason: 'replaced',
    sourceEventId: EVENT_CANDIDATE_02_ID,
    supersedesEventId: null,
    rollbackTargetEventId: null,
    releaseVersionId: VERSION_PRODUCTION_1_ID,
    promptVersionId: promptV3.id,
    promptVersionNumber: promptV3.versionNumber,
    promptVersionSnapshot: promptVersionSnapshot(promptV3),
    modelId: ernie5.id,
    modelSnapshot: modelSnapshot(ernie5),
    trafficMode: null,
    trafficRatio: null,
    sourceExperimentId: '7c54873b-8d0a-5003-8cfb-26f8b8ba7096',
    submitReason: 'Promote v0.2 candidate as production v1.',
    metrics: { accuracy: 0.96, p50LatencyMs: 2920, errorRate: 0.01, quality: releaseQuality(0.806, 128) },
    totalReceived: 128,
    totalProcessed: 126,
    totalFiltered: 0,
    totalCorrect: 121,
    totalErrors: 2,
    startedAt: '2026-05-23T08:00:00.000Z',
    finishedAt: '2026-05-23T08:12:00.000Z',
    createdAt: '2026-05-23T08:00:00.000Z',
    updatedAt: '2026-05-23T08:12:00.000Z',
  }),
  releaseEvent({
    id: EVENT_PRODUCTION_1_CONFIG_ID,
    laneType: 'production',
    operation: 'config_changed',
    status: 'completed',
    terminalReason: 'replaced',
    sourceEventId: EVENT_PRODUCTION_1_ID,
    supersedesEventId: EVENT_PRODUCTION_1_ID,
    rollbackTargetEventId: null,
    releaseVersionId: VERSION_PRODUCTION_1_ID,
    promptVersionId: promptV3.id,
    promptVersionNumber: promptV3.versionNumber,
    promptVersionSnapshot: promptVersionSnapshot(promptV3),
    modelId: ernie5.id,
    modelSnapshot: modelSnapshot(ernie5),
    trafficMode: null,
    trafficRatio: null,
    runConfig: { ...defaultRunConfig, rpmLimit: 36, tpmLimit: 168000, concurrency: 14, temperature: 0.05 },
    sourceExperimentId: '7c54873b-8d0a-5003-8cfb-26f8b8ba7096',
    submitReason: 'Tighten v1 runtime limits after initial production traffic.',
    metrics: { accuracy: 0.962, p50LatencyMs: 2860, errorRate: 0.008, quality: releaseQuality(0.818, 184) },
    totalReceived: 184,
    totalProcessed: 182,
    totalFiltered: 0,
    totalCorrect: 176,
    totalErrors: 2,
    startedAt: '2026-05-23T08:12:00.000Z',
    finishedAt: '2026-05-23T08:42:00.000Z',
    createdAt: '2026-05-23T08:12:00.000Z',
    updatedAt: '2026-05-23T08:42:00.000Z',
  }),
  releaseEvent({
    id: EVENT_CANDIDATE_11_ID,
    laneType: 'canary',
    operation: 'create_canary',
    status: 'completed',
    terminalReason: 'promoted',
    sourceEventId: EVENT_PRODUCTION_1_CONFIG_ID,
    supersedesEventId: null,
    rollbackTargetEventId: null,
    releaseVersionId: VERSION_CANDIDATE_11_ID,
    promptVersionId: promptV3.id,
    promptVersionNumber: promptV3.versionNumber,
    promptVersionSnapshot: promptVersionSnapshot(promptV3),
    modelId: sonnet.id,
    modelSnapshot: modelSnapshot(sonnet),
    trafficMode: 'dual_run',
    trafficRatio: '0.0500',
    sourceExperimentId: null,
    submitReason: 'Canary for production v2 with a different model.',
    metrics: { accuracy: 0.95, p50LatencyMs: 3450, errorRate: 0, quality: releaseQuality(0.832, 27) },
    totalReceived: 27,
    totalProcessed: 27,
    totalFiltered: 0,
    totalCorrect: 25,
    totalErrors: 0,
    startedAt: '2026-05-23T08:30:00.000Z',
    finishedAt: production2Plan.candidateUpdatedAt,
    createdAt: '2026-05-23T08:30:00.000Z',
    updatedAt: production2Plan.candidateUpdatedAt,
  }),
  ...generatedProductionPlans.flatMap((plan) => {
    const isLatestProduction = plan.productionNumber === 10;
    const candidateEvents =
      plan.productionNumber === 2
        ? []
        : [
            releaseEvent({
              id: plan.candidateEventId,
              laneType: 'canary',
              operation: 'create_canary',
              status: 'completed',
              terminalReason: 'promoted',
              sourceEventId: plan.previousProductionEventId,
              supersedesEventId: null,
              rollbackTargetEventId: null,
              releaseVersionId: plan.candidateVersionId,
              promptVersionId: plan.promptVersion.id,
              promptVersionNumber: plan.promptVersion.versionNumber,
              promptVersionSnapshot: promptVersionSnapshot(plan.promptVersion),
              modelId: plan.model.id,
              modelSnapshot: modelSnapshot(plan.model),
              trafficMode: plan.productionNumber % 2 === 0 ? 'split' : 'dual_run',
              trafficRatio: plan.productionNumber % 2 === 0 ? '0.1800' : '0.0600',
              runConfig: candidateRunConfig(plan.productionNumber),
              sourceExperimentId: null,
              submitReason: `Canary for production v${plan.productionNumber}; verify release history density and candidate grouping.`,
              metrics: {
                accuracy: Number((0.94 + plan.productionNumber * 0.002).toFixed(3)),
                p50LatencyMs: 3000 + plan.productionNumber * 35,
                errorRate: 0.01,
                quality: releaseQuality(0.79 + plan.productionNumber * 0.007, 40 + plan.productionNumber * 7),
              },
              totalReceived: 40 + plan.productionNumber * 7,
              totalProcessed: 39 + plan.productionNumber * 7,
              totalFiltered: 1,
              totalCorrect: 36 + plan.productionNumber * 7,
              totalErrors: 1,
              startedAt: plan.candidateCreatedAt,
              finishedAt: plan.candidateUpdatedAt,
              createdAt: plan.candidateCreatedAt,
              updatedAt: plan.candidateUpdatedAt,
            }),
          ];

    return [
      ...candidateEvents,
      releaseEvent({
        id: plan.productionEventId,
        laneType: 'production',
        operation: 'promote_canary',
        status: 'completed',
        terminalReason: 'replaced',
        sourceEventId: plan.candidateEventId,
        supersedesEventId: plan.previousProductionEventId,
        rollbackTargetEventId: null,
        releaseVersionId: plan.productionVersionId,
        promptVersionId: plan.promptVersion.id,
        promptVersionNumber: plan.promptVersion.versionNumber,
        promptVersionSnapshot: promptVersionSnapshot(plan.promptVersion),
        modelId: plan.model.id,
        modelSnapshot: modelSnapshot(plan.model),
        trafficMode: null,
        trafficRatio: null,
        sourceExperimentId: null,
        submitReason: `Promote candidate as production v${plan.productionNumber}.`,
        metrics: {
          accuracy: Number((0.945 + plan.productionNumber * 0.002).toFixed(3)),
          p50LatencyMs: 2920 + plan.productionNumber * 28,
          errorRate: 0.009,
          quality: releaseQuality(0.805 + plan.productionNumber * 0.007, 120 + plan.productionNumber * 24),
        },
        totalReceived: 120 + plan.productionNumber * 24,
        totalProcessed: 118 + plan.productionNumber * 24,
        totalFiltered: 0,
        totalCorrect: 112 + plan.productionNumber * 23,
        totalErrors: 2,
        startedAt: plan.productionCreatedAt,
        finishedAt: plan.configCreatedAt,
        createdAt: plan.productionCreatedAt,
        updatedAt: plan.productionUpdatedAt,
      }),
      releaseEvent({
        id: plan.configEventId,
        laneType: 'production',
        operation: 'config_changed',
        status: isLatestProduction ? 'running' : 'completed',
        terminalReason: isLatestProduction ? null : 'replaced',
        sourceEventId: plan.productionEventId,
        supersedesEventId: plan.productionEventId,
        rollbackTargetEventId: null,
        releaseVersionId: plan.productionVersionId,
        promptVersionId: plan.promptVersion.id,
        promptVersionNumber: plan.promptVersion.versionNumber,
        promptVersionSnapshot: promptVersionSnapshot(plan.promptVersion),
        modelId: plan.model.id,
        modelSnapshot: modelSnapshot(plan.model),
        trafficMode: null,
        trafficRatio: null,
        runConfig: tunedProductionRunConfig(plan.productionNumber),
        outputMapping:
          plan.productionNumber % 2 === 0
            ? outputMapping
            : [...outputMapping, { from: 'raw_response', to: `debug_raw_v${plan.productionNumber}` }],
        sourceExperimentId: null,
        submitReason: `Adjust runtime and output mapping for production v${plan.productionNumber}.`,
        metrics: {
          accuracy: Number((0.948 + plan.productionNumber * 0.002).toFixed(3)),
          p50LatencyMs: 2860 + plan.productionNumber * 24,
          errorRate: 0.008,
          quality: releaseQuality(0.812 + plan.productionNumber * 0.007, 150 + plan.productionNumber * 28),
        },
        totalReceived: 150 + plan.productionNumber * 28,
        totalProcessed: 148 + plan.productionNumber * 28,
        totalFiltered: 0,
        totalCorrect: 142 + plan.productionNumber * 27,
        totalErrors: 2,
        startedAt: plan.configCreatedAt,
        finishedAt: isLatestProduction ? null : plan.configUpdatedAt,
        createdAt: plan.configCreatedAt,
        updatedAt: plan.configUpdatedAt,
      }),
    ];
  }),
  releaseEvent({
    id: activeCandidatePlan.candidateEventId,
    laneType: 'canary',
    operation: 'create_canary',
    status: 'completed',
    terminalReason: 'replaced',
    sourceEventId: activeCandidatePlan.previousProductionEventId,
    supersedesEventId: null,
    rollbackTargetEventId: null,
    releaseVersionId: activeCandidatePlan.candidateVersionId,
    promptVersionId: activeCandidatePlan.promptVersion.id,
    promptVersionNumber: activeCandidatePlan.promptVersion.versionNumber,
    promptVersionSnapshot: promptVersionSnapshot(activeCandidatePlan.promptVersion),
    modelId: activeCandidatePlan.model.id,
    modelSnapshot: modelSnapshot(activeCandidatePlan.model),
    trafficMode: 'dual_run',
    trafficRatio: '0.0500',
    runConfig: candidateRunConfig(activeCandidatePlan.targetProductionNumber),
    sourceExperimentId: null,
    submitReason: 'Active canary for production v11; keeps the history tab showing the live next-version group.',
    metrics: { accuracy: 0.967, p50LatencyMs: 3360, errorRate: 0, quality: releaseQuality(0.873, 46) },
    totalReceived: 46,
    totalProcessed: 46,
    totalFiltered: 0,
    totalCorrect: 44,
    totalErrors: 0,
    startedAt: activeCandidatePlan.candidateCreatedAt,
    finishedAt: activeCandidatePlan.configCreatedAt,
    createdAt: activeCandidatePlan.candidateCreatedAt,
    updatedAt: activeCandidatePlan.configCreatedAt,
  }),
  releaseEvent({
    id: activeCandidatePlan.configEventId,
    laneType: 'canary',
    operation: 'config_changed',
    status: 'running',
    terminalReason: null,
    sourceEventId: activeCandidatePlan.candidateEventId,
    supersedesEventId: activeCandidatePlan.candidateEventId,
    rollbackTargetEventId: null,
    releaseVersionId: activeCandidatePlan.candidateVersionId,
    promptVersionId: activeCandidatePlan.promptVersion.id,
    promptVersionNumber: activeCandidatePlan.promptVersion.versionNumber,
    promptVersionSnapshot: promptVersionSnapshot(activeCandidatePlan.promptVersion),
    modelId: activeCandidatePlan.model.id,
    modelSnapshot: modelSnapshot(activeCandidatePlan.model),
    trafficMode: 'dual_run',
    trafficRatio: '0.0800',
    runConfig: {
      ...candidateRunConfig(activeCandidatePlan.targetProductionNumber),
      concurrency: 8,
      temperature: 0.16,
    },
    sourceExperimentId: null,
    submitReason: 'Raise v11 canary mirror traffic and lower concurrency after the first smoke window.',
    metrics: { accuracy: 0.969, p50LatencyMs: 3290, errorRate: 0, quality: releaseQuality(0.884, 68) },
    totalReceived: 68,
    totalProcessed: 68,
    totalFiltered: 0,
    totalCorrect: 66,
    totalErrors: 0,
    startedAt: activeCandidatePlan.configCreatedAt,
    finishedAt: null,
    createdAt: activeCandidatePlan.configCreatedAt,
    updatedAt: activeCandidatePlan.configUpdatedAt,
  }),
];

function datasetSample(index: number) {
  return requireFixture(yelpDataset.samples[index], `Yelp sample ${index}`);
}

function sampleText(index: number): string {
  return String(datasetSample(index).data['text'] ?? '');
}

function expectedOutput(index: number): string {
  return String(datasetSample(index).data['expected_output'] ?? 'positive');
}

function releaseRunResult(input: {
  id: string;
  sourceId: string;
  releaseVersionId: string;
  promptVersionId: string;
  modelId: string;
  sampleIndex: number;
  decisionOutput?: string;
  createdAt: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: string;
}): DevReleaseRunResultFixture {
  const sample = datasetSample(input.sampleIndex);
  const expected = expectedOutput(input.sampleIndex);
  const decision = input.decisionOutput ?? expected;
  const isCorrect = decision === expected;
  return {
    id: input.id,
    sourceId: input.sourceId,
    releaseVersionId: input.releaseVersionId,
    promptVersionId: input.promptVersionId,
    modelId: input.modelId,
    sampleId: sample.id,
    externalId: sample.externalId,
    renderedPrompt: {
      messages: [{ role: 'user', content: sampleText(input.sampleIndex) }],
    },
    inputVariables: { text: sampleText(input.sampleIndex) },
    rawResponse: decision,
    parsedOutput: { expected_output: decision },
    decisionOutput: decision,
    expectedOutput: expected,
    isCorrect,
    judgmentStatus: isCorrect ? 'correct' : 'incorrect',
    status: 'success',
    errorClass: null,
    errorMessage: null,
    latencyMs: input.latencyMs,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costEstimate: input.costEstimate,
    createdAt: input.createdAt,
  };
}

export const DEV_RELEASE_RUN_RESULTS: DevReleaseRunResultFixture[] = [
  releaseRunResult({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000101',
    sourceId: EVENT_CANDIDATE_01_ID,
    releaseVersionId: VERSION_CANDIDATE_01_ID,
    promptVersionId: promptV2.id,
    modelId: ernie5.id,
    sampleIndex: 0,
    createdAt: '2026-05-23T07:21:00.000Z',
    latencyMs: 3180,
    inputTokens: 510,
    outputTokens: 3,
    costEstimate: '0.000058',
  }),
  releaseRunResult({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000102',
    sourceId: EVENT_CANDIDATE_01_ID,
    releaseVersionId: VERSION_CANDIDATE_01_ID,
    promptVersionId: promptV2.id,
    modelId: ernie5.id,
    sampleIndex: 1,
    decisionOutput: 'positive',
    createdAt: '2026-05-23T07:22:00.000Z',
    latencyMs: 4210,
    inputTokens: 402,
    outputTokens: 3,
    costEstimate: '0.000047',
  }),
  releaseRunResult({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000111',
    sourceId: EVENT_CANDIDATE_02_ID,
    releaseVersionId: VERSION_CANDIDATE_02_ID,
    promptVersionId: promptV3.id,
    modelId: ernie5.id,
    sampleIndex: 2,
    createdAt: '2026-05-23T07:36:00.000Z',
    latencyMs: 2860,
    inputTokens: 730,
    outputTokens: 3,
    costEstimate: '0.000081',
  }),
  releaseRunResult({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000112',
    sourceId: EVENT_CANDIDATE_02_ID,
    releaseVersionId: VERSION_CANDIDATE_02_ID,
    promptVersionId: promptV3.id,
    modelId: ernie5.id,
    sampleIndex: 3,
    createdAt: '2026-05-23T07:37:00.000Z',
    latencyMs: 2990,
    inputTokens: 820,
    outputTokens: 3,
    costEstimate: '0.000091',
  }),
  releaseRunResult({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000121',
    sourceId: EVENT_PRODUCTION_1_ID,
    releaseVersionId: VERSION_PRODUCTION_1_ID,
    promptVersionId: promptV3.id,
    modelId: ernie5.id,
    sampleIndex: 4,
    createdAt: '2026-05-23T08:01:00.000Z',
    latencyMs: 2710,
    inputTokens: 690,
    outputTokens: 3,
    costEstimate: '0.000077',
  }),
  releaseRunResult({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000122',
    sourceId: EVENT_PRODUCTION_1_ID,
    releaseVersionId: VERSION_PRODUCTION_1_ID,
    promptVersionId: promptV3.id,
    modelId: ernie5.id,
    sampleIndex: 5,
    createdAt: '2026-05-23T08:02:00.000Z',
    latencyMs: 2880,
    inputTokens: 612,
    outputTokens: 3,
    costEstimate: '0.000068',
  }),
  releaseRunResult({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000123',
    sourceId: EVENT_PRODUCTION_1_ID,
    releaseVersionId: VERSION_PRODUCTION_1_ID,
    promptVersionId: promptV3.id,
    modelId: ernie5.id,
    sampleIndex: 6,
    decisionOutput: 'positive',
    createdAt: '2026-05-23T08:03:00.000Z',
    latencyMs: 3340,
    inputTokens: 640,
    outputTokens: 3,
    costEstimate: '0.000071',
  }),
  releaseRunResult({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000124',
    sourceId: EVENT_PRODUCTION_1_ID,
    releaseVersionId: VERSION_PRODUCTION_1_ID,
    promptVersionId: promptV3.id,
    modelId: ernie5.id,
    sampleIndex: 7,
    createdAt: '2026-05-23T08:04:00.000Z',
    latencyMs: 2590,
    inputTokens: 530,
    outputTokens: 3,
    costEstimate: '0.000060',
  }),
  releaseRunResult({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000131',
    sourceId: EVENT_CANDIDATE_11_ID,
    releaseVersionId: VERSION_CANDIDATE_11_ID,
    promptVersionId: promptV3.id,
    modelId: sonnet.id,
    sampleIndex: 8,
    createdAt: '2026-05-23T08:31:00.000Z',
    latencyMs: 3540,
    inputTokens: 720,
    outputTokens: 3,
    costEstimate: '0.002205',
  }),
  releaseRunResult({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000132',
    sourceId: EVENT_CANDIDATE_11_ID,
    releaseVersionId: VERSION_CANDIDATE_11_ID,
    promptVersionId: promptV3.id,
    modelId: sonnet.id,
    sampleIndex: 9,
    createdAt: '2026-05-23T08:32:00.000Z',
    latencyMs: 3710,
    inputTokens: 680,
    outputTokens: 3,
    costEstimate: '0.002085',
  }),
];

const annotationOptions = ['positive', 'negative'];

export const DEV_RELEASE_ANNOTATION_TASKS: DevReleaseAnnotationTaskFixture[] = [
  {
    id: ANNOTATION_TASK_ID,
    scope: 'online',
    releaseLineEventId: EVENT_PRODUCTION_1_ID,
    releaseVersionId: VERSION_PRODUCTION_1_ID,
    releaseVersionScope: 'exact',
    name: 'sentiment-classifier-live · v1 spot check',
    annotationSchema: [
      {
        name: 'expected_output',
        type: 'single_select',
        required: true,
        options: annotationOptions,
      },
    ],
    samplingConfig: {
      releaseLineId: RELEASE_LINE_ID,
      releaseVersionId: VERSION_PRODUCTION_1_ID,
      releaseVersionScope: 'exact',
      scope: 'online',
      availableCount: 4,
      sampleSize: 4,
    },
    totalSampled: 4,
    totalAnnotated: 3,
    status: 'active',
    createdAt: '2026-05-23T08:10:00.000Z',
    updatedAt: '2026-05-23T08:18:00.000Z',
  },
];

export const DEV_RELEASE_ANNOTATIONS: DevReleaseAnnotationFixture[] = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000201',
    runResultId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000121',
    runResultCreatedAt: '2026-05-23T08:01:00.000Z',
    taskId: ANNOTATION_TASK_ID,
    isCorrect: true,
    fields: { expected_output: expectedOutput(4) },
    notes: 'Matches human review.',
    lockedBy: null,
    lockedAt: null,
    lockHeartbeatAt: null,
    submittedAt: '2026-05-23T08:12:00.000Z',
    submittedBy: LOCAL_ACTOR_ID,
    createdAt: '2026-05-23T08:10:00.000Z',
    updatedAt: '2026-05-23T08:12:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000202',
    runResultId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000122',
    runResultCreatedAt: '2026-05-23T08:02:00.000Z',
    taskId: ANNOTATION_TASK_ID,
    isCorrect: true,
    fields: { expected_output: expectedOutput(5) },
    notes: null,
    lockedBy: null,
    lockedAt: null,
    lockHeartbeatAt: null,
    submittedAt: '2026-05-23T08:14:00.000Z',
    submittedBy: LOCAL_ACTOR_ID,
    createdAt: '2026-05-23T08:10:00.000Z',
    updatedAt: '2026-05-23T08:14:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000203',
    runResultId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000123',
    runResultCreatedAt: '2026-05-23T08:03:00.000Z',
    taskId: ANNOTATION_TASK_ID,
    isCorrect: false,
    fields: { expected_output: expectedOutput(6) },
    notes: 'Surface-level positive output misses the complaint.',
    lockedBy: null,
    lockedAt: null,
    lockHeartbeatAt: null,
    submittedAt: '2026-05-23T08:18:00.000Z',
    submittedBy: LOCAL_ACTOR_ID,
    createdAt: '2026-05-23T08:10:00.000Z',
    updatedAt: '2026-05-23T08:18:00.000Z',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000204',
    runResultId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000124',
    runResultCreatedAt: '2026-05-23T08:04:00.000Z',
    taskId: ANNOTATION_TASK_ID,
    isCorrect: null,
    fields: {},
    notes: null,
    lockedBy: null,
    lockedAt: null,
    lockHeartbeatAt: null,
    submittedAt: null,
    submittedBy: null,
    createdAt: '2026-05-23T08:10:00.000Z',
    updatedAt: '2026-05-23T08:10:00.000Z',
  },
];
