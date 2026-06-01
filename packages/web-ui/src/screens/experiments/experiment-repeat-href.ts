import type { ExperimentRunConfigDto } from '@proofhound/shared';

export function appendSearchParam(
  params: URLSearchParams,
  key: string,
  value: string | number | null | undefined,
) {
  if (value === null || value === undefined || value === '') return;
  params.set(key, String(value));
}

export function appendNumberSearchParam(
  params: URLSearchParams,
  key: string,
  value: number | null | undefined,
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  params.set(key, String(value));
}

export interface RepeatExperimentSource {
  id: string;
  name: string;
  promptId?: string | null;
  promptVersionId?: string | null;
  datasetId?: string | null;
  datasetName?: string | null;
  datasetSamples?: number | null;
  modelId?: string | null;
  description?: string | null;
  runConfig: ExperimentRunConfigDto;
}

export function buildRepeatExperimentHref(projectId: string, source: RepeatExperimentSource) {
  const params = new URLSearchParams();
  const runConfig = source.runConfig;

  appendSearchParam(params, 'sourceExperimentId', source.id);
  appendSearchParam(params, 'promptId', source.promptId);
  appendSearchParam(params, 'promptVersionId', source.promptVersionId);
  appendSearchParam(params, 'datasetId', source.datasetId);
  appendSearchParam(params, 'datasetName', source.datasetName);
  appendNumberSearchParam(params, 'sampleCount', source.datasetSamples);
  appendSearchParam(params, 'modelId', source.modelId);
  appendSearchParam(params, 'name', `${source.name}-rerun`);
  appendSearchParam(params, 'description', source.description);
  appendNumberSearchParam(params, 'concurrency', runConfig.concurrency);
  appendNumberSearchParam(params, 'rpmLimit', runConfig.rpmLimit);
  appendNumberSearchParam(params, 'tpmLimit', runConfig.tpmLimit);
  appendNumberSearchParam(params, 'temperature', runConfig.temperature);
  appendNumberSearchParam(params, 'sampleTimeoutSeconds', runConfig.sampleTimeoutSeconds);
  appendNumberSearchParam(params, 'retries', runConfig.retries);
  appendSearchParam(params, 'imageEncoding', runConfig.imageEncoding);

  return `/experiments/new?${params.toString()}`;
}
