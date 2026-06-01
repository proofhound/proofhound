import { describe, expect, it } from 'vitest';
import {
  buildReleaseLlmPayload,
  buildReleaseOutputPayload,
  computeReleaseRunResultId,
  mapCanaryVariables,
  matchesCanaryFilter,
  normalizeQueuePayload,
  passesTrafficRatio,
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
    const llmPayload = buildReleaseLlmPayload({ release, ...mapped, runResultId });

    expect(runResultId).toBe(sameRunResultId);
    expect(llmPayload).toMatchObject({
      projectId: release.projectId,
      source: 'release',
      sourceId: release.id,
      runResultId,
      externalId: 's-1',
      inputVariables: { text: '很好' },
      limits: { rpmLimit: 60, tpmLimit: 60_000, concurrency: 2 },
    });
    expect(llmPayload.judgment).toBeUndefined();
    expect(llmPayload.renderedPrompt.prompt).toContain('很好');
  });

  it('only enables automatic judgment when release input carries expected output', () => {
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
});
