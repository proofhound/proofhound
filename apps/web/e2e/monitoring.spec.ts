import { expect, test, type APIRequestContext } from '@playwright/test';
import type {
  ExperimentListItemDto,
  ModelMonitoringRankingResponseDto,
  ProjectMonitoringStatsDto,
  ProjectMonitoringTimeseriesDto,
  PromptMonitoringRankingResponseDto,
} from '@proofhound/shared';
import {
  ResourceLedger,
  SERVER_URL,
  seedDataset,
  seedExperiment,
  seedModel,
  seedPrompt,
  seedPromptVersion,
} from './support/api';

const SAMPLE_COUNT = 6;
const TOKENS_PER_SAMPLE = 15;

test('monitoring API reflects captured experiment run results', async ({ request }) => {
  test.setTimeout(150_000); // real worker + fake LLM + monitoring aggregation polling
  const ledger = new ResourceLedger(request);
  const tag = `e2e-monitor-${Date.now()}`;
  const from = new Date(Date.now() - 5 * 60_000).toISOString();

  try {
    const datasetId = await seedDataset(request, { name: `${tag}-ds` });
    ledger.track('dataset', `/datasets/${datasetId}`);
    const promptId = await seedPrompt(request, `${tag}-prompt`);
    ledger.track('prompt', `/prompts/${promptId}`);
    const versionId = await seedPromptVersion(request, promptId, { withMarker: true });
    const modelId = await seedModel(request, `${tag}-model`);
    ledger.track('model', `/models/${modelId}`);
    const experimentId = await seedExperiment(request, {
      name: `${tag}-experiment`,
      promptVersionId: versionId,
      datasetId,
      modelId,
    });
    ledger.track('experiment', `/experiments/${experimentId}`);

    const experiment = await waitForExperimentSuccess(request, experimentId);
    expect(experiment.processedSamples).toBe(SAMPLE_COUNT);
    expect(experiment.failedSamples).toBe(0);

    const to = new Date(Date.now() + 5 * 60_000).toISOString();
    const filter = monitoringFilter({ from, to, promptId, modelId });
    const expectedTokens = SAMPLE_COUNT * TOKENS_PER_SAMPLE;

    const stats = await getJson<ProjectMonitoringStatsDto>(request, `/monitoring/stats?${filter}`);
    expect(stats.requests).toMatchObject({
      total: SAMPLE_COUNT,
      bySource: { prod: 0, canary: 0, iter: 0, exp: SAMPLE_COUNT },
    });
    expect(stats.errors).toMatchObject({
      total: 0,
      bySource: { prod: 0, canary: 0, iter: 0, exp: 0 },
    });
    expect(stats.tokens).toMatchObject({
      total: expectedTokens,
      bySource: { prod: 0, canary: 0, iter: 0, exp: expectedTokens },
    });
    expect(stats.rpmPeak.total).toBeGreaterThanOrEqual(1);
    expect(stats.tpmPeak.total).toBeGreaterThanOrEqual(TOKENS_PER_SAMPLE);
    expect(stats.latencyAverageMs.total).toBeGreaterThan(0);

    const timeseries = await getJson<ProjectMonitoringTimeseriesDto>(request, `/monitoring/timeseries?${filter}`);
    expect(sumBySource(timeseries.points, 'requests', 'exp')).toBe(SAMPLE_COUNT);
    expect(sumBySource(timeseries.points, 'errors', 'exp')).toBe(0);
    expect(sumBySource(timeseries.points, 'tokens', 'exp')).toBe(expectedTokens);

    const promptRanking = await getJson<PromptMonitoringRankingResponseDto>(
      request,
      `/monitoring/prompts/ranking?${filter}&sortBy=requests`,
    );
    expect(promptRanking.items).toHaveLength(1);
    expect(promptRanking.items[0]).toMatchObject({
      promptId,
      promptName: `${tag}-prompt`,
      requestCount: SAMPLE_COUNT,
      shareRatio: 1,
      failureRate: 0,
      hitRate: 1,
    });

    const modelRanking = await getJson<ModelMonitoringRankingResponseDto>(
      request,
      `/monitoring/models/ranking?${filter}&sortBy=requests`,
    );
    expect(modelRanking.items).toHaveLength(1);
    expect(modelRanking.items[0]).toMatchObject({
      modelId,
      modelName: `${tag}-model`,
      requestCount: SAMPLE_COUNT,
      totalTokens: expectedTokens,
      rpmLimit: 600,
    });
    expect(modelRanking.items[0]?.capacityUsedRatio).toBeGreaterThan(0);
  } finally {
    await ledger.cleanup();
  }
});

async function waitForExperimentSuccess(request: APIRequestContext, experimentId: string) {
  const deadline = Date.now() + 90_000;

  for (;;) {
    const experiment = await getJson<ExperimentListItemDto>(request, `/experiments/${experimentId}`);
    if (experiment.status === 'success') return experiment;
    if (['failed', 'stopped', 'cancelled'].includes(experiment.status)) {
      throw new Error(`experiment ${experimentId} ended as ${experiment.status}: ${experiment.failureReason ?? ''}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`experiment ${experimentId} did not reach success before monitoring assertion`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${SERVER_URL}${path}`);
  if (!response.ok()) throw new Error(`GET ${path} -> ${response.status()}: ${await response.text()}`);
  return (await response.json()) as T;
}

function monitoringFilter({
  from,
  to,
  promptId,
  modelId,
}: {
  from: string;
  to: string;
  promptId: string;
  modelId: string;
}) {
  return new URLSearchParams({
    from,
    to,
    granularity: 'minute',
    promptIds: promptId,
    modelIds: modelId,
    sources: 'exp',
  }).toString();
}

function sumBySource(
  points: ProjectMonitoringTimeseriesDto['points'],
  metric: 'requests' | 'errors' | 'tokens',
  source: 'exp',
) {
  return points.reduce((sum, point) => sum + point[metric][source], 0);
}
