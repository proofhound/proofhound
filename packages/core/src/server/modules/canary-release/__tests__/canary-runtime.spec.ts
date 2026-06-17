import { describe, expect, it } from 'vitest';
import {
  buildReleaseLlmPayload,
  buildReleaseOutputPayload,
  computeReleaseRunResultId,
  mapCanaryVariables,
  matchesCanaryFilter,
  normalizeQueuePayload,
  OUTPUT_MAPPING_CONNECTOR_EXCLUDED,
  passesTrafficRatio,
  selectOutputMappingForConnector,
  type CanaryRuntimeConfig,
} from '../canary-runtime';

const release: CanaryRuntimeConfig = {
  id: '77777777-7777-4777-8777-777777777777',
  projectId: '11111111-1111-4111-8111-111111111111',
  promptVersionId: '33333333-3333-4333-8333-333333333333',
  promptId: '22222222-2222-4222-8222-222222222222',
  modelId: '44444444-4444-4444-8444-444444444444',
  variableMapping: [
    { source: 'sample_id', target: 'id', required: true },
    { source: 'text', target: 'text', required: true },
  ],
  filterRules: { type: 'atom', field: 'channel', op: 'eq', value: 'queue' },
  externalIdField: 'sample_id',
  runConfig: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 2 },
  promptBody: '判断这段文本: {{text}}',
  promptVariables: [{ name: 'text', type: 'text', required: true, datasetField: 'text' }],
  promptOutputSchema: { fields: [{ key: 'label', value: 'positive or negative', isJudgment: true }] },
  promptJudgmentRules: { correct: ['positive'] },
  promptLanguage: 'zh-CN',
  outputMapping: [],
};

describe('release runtime helpers', () => {
  it('maps queue payloads into unified release LLM payloads with stable run result ids', () => {
    const payload = normalizeQueuePayload({ sample_id: 's-1', text: '很好', channel: 'queue' });
    expect(matchesCanaryFilter(release.filterRules, payload)).toBe(true);

    const mapped = mapCanaryVariables(release, payload);
    const runResultId = computeReleaseRunResultId(release.id, 'topic:0:42');
    const sameRunResultId = computeReleaseRunResultId(release.id, 'topic:0:42');
    const orgScopedRelease = { ...release, orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const llmPayload = buildReleaseLlmPayload({ release: orgScopedRelease, ...mapped, runResultId });

    expect(runResultId).toBe(sameRunResultId);
    expect(llmPayload).toMatchObject({
      projectId: release.projectId,
      orgId: orgScopedRelease.orgId,
      source: 'release',
      sourceId: release.id,
      runResultId,
      externalId: 's-1',
      inputVariables: { text: '很好' },
      limits: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 2 },
    });
    expect(llmPayload.judgment).toMatchObject({
      outputSchema: release.promptOutputSchema,
      judgmentRules: release.promptJudgmentRules,
    });
    expect(llmPayload.judgment).not.toHaveProperty('expectedOutput');
    expect(llmPayload.renderedPrompt.prompt).toContain('很好');
  });

  it('includes expected output in judgment when release input carries it', () => {
    const payload = normalizeQueuePayload({
      sample_id: 's-1',
      text: '很好',
      expected_output: 'positive',
      channel: 'queue',
    });
    const mapped = mapCanaryVariables(release, payload);
    const runResultId = computeReleaseRunResultId(release.id, 'topic:0:42');
    const llmPayload = buildReleaseLlmPayload({
      release,
      ...mapped,
      rawPayload: payload,
      runResultId,
    });

    expect(llmPayload.judgment).toMatchObject({
      outputSchema: release.promptOutputSchema,
      judgmentRules: release.promptJudgmentRules,
      expectedOutput: 'positive',
    });
  });

  it('uses deterministic traffic sampling', () => {
    const first = passesTrafficRatio(release.id, 'topic:0:42', 0.5);
    const second = passesTrafficRatio(release.id, 'topic:0:42', 0.5);

    expect(first).toBe(second);
    expect(passesTrafficRatio(release.id, 'topic:0:42', 1)).toBe(true);
    expect(passesTrafficRatio(release.id, 'topic:0:42', 0)).toBe(false);
  });

  it('builds output payloads with release source and mapped result fields', () => {
    const payload = buildReleaseOutputPayload({
      release: {
        id: release.id,
        outputMapping: [
          { source: 'label', target: 'prediction.label' },
          { source: 'external_id', target: 'metadata.external_id' },
        ],
      },
      runResult: {
        id: '88888888-8888-4888-8888-888888888888',
        createdAt: new Date('2026-05-21T10:00:02.000Z'),
        externalId: 'sample-1',
        status: 'success',
        rawResponse: '{"label":"positive"}',
        parsedOutput: { label: 'positive' },
        decisionOutput: 'positive',
        errorClass: null,
        errorMessage: null,
        latencyMs: 123,
        inputTokens: 12,
        outputTokens: 5,
        costEstimate: 0.001,
      },
    });

    expect(payload).toMatchObject({
      external_id: 'sample-1',
      run_result_id: '88888888-8888-4888-8888-888888888888',
      status: 'success',
      result: {
        prediction: { label: 'positive' },
        metadata: { external_id: 'sample-1' },
      },
      source: { type: 'release', id: release.id },
      created_at: '2026-05-21T10:00:02.000Z',
    });
  });

  it('selects output mappings per output connector while preserving legacy lane-wide mappings', () => {
    const connectorMapping = [
      {
        connectorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        outputMapping: [{ source: 'label', target: 'redis.label' }],
      },
      {
        connectorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        outputMapping: [{ source: 'decision_output', target: 'kafka.decision' }],
      },
    ];

    expect(selectOutputMappingForConnector(connectorMapping, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toEqual([
      { source: 'decision_output', target: 'kafka.decision' },
    ]);
    // A connector excluded from a configured per-connector mapping is signalled
    // distinctly so the runner skips delivery — it must NOT fall through to the
    // legacy raw envelope (BUG A6).
    expect(selectOutputMappingForConnector(connectorMapping, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toBe(
      OUTPUT_MAPPING_CONNECTOR_EXCLUDED,
    );
    // Legacy flat mapping array applies to every connector unchanged.
    expect(
      selectOutputMappingForConnector([{ source: 'label', target: 'prediction.label' }], 'ignored-connector-id'),
    ).toEqual([{ source: 'label', target: 'prediction.label' }]);
    // Truly unconfigured mappings (empty / non-array) stay the legacy raw-emitting case.
    expect(selectOutputMappingForConnector([], 'any-connector-id')).toEqual([]);
    expect(selectOutputMappingForConnector(undefined, 'any-connector-id')).toEqual([]);
    // A matched connector with empty rows still receives the default envelope shape (SPEC 27 §15).
    expect(
      selectOutputMappingForConnector(
        [{ connectorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', outputMapping: [] }],
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    ).toEqual([]);
  });

  it('does not leak raw output to a connector excluded from a per-connector mapping, while legacy flat mapping still emits raw', () => {
    const runResult = {
      id: '88888888-8888-4888-8888-888888888888',
      createdAt: new Date('2026-05-21T10:00:02.000Z'),
      externalId: 'sample-1',
      status: 'success',
      rawResponse: '{"label":"positive","secret":"leak-me"}',
      parsedOutput: { label: 'positive', secret: 'leak-me' },
      decisionOutput: 'positive',
      errorClass: null,
      errorMessage: null,
      latencyMs: 123,
      inputTokens: 12,
      outputTokens: 5,
      costEstimate: 0.001,
    };

    const perConnectorMapping = [
      {
        connectorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        outputMapping: [{ source: 'label', target: 'redis.label' }],
      },
    ];

    // Excluded connector: the runner sees the sentinel and skips delivery — the full
    // parsed/raw payload is never emitted to it.
    const excludedSelection = selectOutputMappingForConnector(
      perConnectorMapping,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    );
    expect(excludedSelection).toBe(OUTPUT_MAPPING_CONNECTOR_EXCLUDED);

    // Legacy flat mapping (no connector entries) keeps emitting the raw default envelope.
    const legacySelection = selectOutputMappingForConnector([], 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(legacySelection).toEqual([]);
    const legacyPayload = buildReleaseOutputPayload({
      release: { id: release.id, outputMapping: legacySelection },
      runResult,
    });
    expect(legacyPayload.result).toEqual({ label: 'positive', secret: 'leak-me' });
  });
});
