import { describe, expect, it } from 'vitest';
import { DEV_EXPERIMENTS, DEV_EXPERIMENT_DATASETS } from './experiments';
import { DEV_MODELS } from './models';
import { DEV_PROMPTS } from './prompts';
import {
  DEV_RELEASE_ANNOTATIONS,
  DEV_RELEASE_ANNOTATION_TASKS,
  DEV_RELEASE_EVENTS,
  DEV_RELEASE_LINES,
  DEV_RELEASE_RUN_RESULTS,
  DEV_RELEASE_VERSIONS,
} from './releases';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function variableMappingRecord(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((item): item is { target: string; source: string } => {
          return isRecord(item) && typeof item.target === 'string' && typeof item.source === 'string';
        })
        .map((item) => [item.target, item.source]),
    );
  }
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function promptVariableNames(snapshot: unknown): string[] {
  const variables = isRecord(snapshot) && Array.isArray(snapshot.variables) ? snapshot.variables : [];
  return variables
    .filter((variable): variable is { name: string } => isRecord(variable) && typeof variable.name === 'string')
    .map((variable) => variable.name)
    .filter(Boolean);
}

function expectQualityMetricSet(value: unknown, label: string) {
  expect(isRecord(value), `${label} must be a quality metric object`).toBe(true);
  if (!isRecord(value)) return;

  for (const key of ['recall', 'precision', 'f1', 'accuracy'] as const) {
    expect(typeof value[key], `${label}.${key} must be numeric`).toBe('number');
    expect(value[key], `${label}.${key} must be a 0..1 ratio`).toBeGreaterThanOrEqual(0);
    expect(value[key], `${label}.${key} must be a 0..1 ratio`).toBeLessThanOrEqual(1);
  }
  expect(Number.isInteger(value.sampleCount), `${label}.sampleCount must be an integer`).toBe(true);
  expect(value.sampleCount, `${label}.sampleCount must be seeded`).toBeGreaterThan(0);
}

describe('DEV_RELEASE fixtures', () => {
  it('reference existing prompt versions, models, connectors, experiments, and dataset samples', () => {
    const promptIds = new Set(DEV_PROMPTS.map((prompt) => prompt.id));
    const promptVersionIds = new Set(DEV_PROMPTS.flatMap((prompt) => prompt.versions.map((version) => version.id)));
    const modelIds = new Set(DEV_MODELS.map((model) => model.id));
    const experimentIds = new Set(DEV_EXPERIMENTS.map((experiment) => experiment.id));
    const sampleIds = new Set(DEV_EXPERIMENT_DATASETS.flatMap((dataset) => dataset.samples.map((sample) => sample.id)));

    for (const line of DEV_RELEASE_LINES) {
      expect(promptIds.has(line.promptId), `${line.name} promptId must reference a dev prompt`).toBe(true);
    }

    for (const version of DEV_RELEASE_VERSIONS) {
      expect(promptIds.has(version.promptId), `${version.id} promptId must reference a dev prompt`).toBe(true);
      expect(
        promptVersionIds.has(version.promptVersionId),
        `${version.id} promptVersionId must reference a dev prompt version`,
      ).toBe(true);
      expect(modelIds.has(version.modelId), `${version.id} modelId must reference a dev model`).toBe(true);
    }

    for (const event of DEV_RELEASE_EVENTS) {
      expect(
        promptVersionIds.has(event.promptVersionId),
        `${event.id} promptVersionId must reference a dev prompt version`,
      ).toBe(true);
      expect(modelIds.has(event.modelId), `${event.id} modelId must reference a dev model`).toBe(true);
      if (event.sourceExperimentId) {
        expect(
          experimentIds.has(event.sourceExperimentId),
          `${event.id} sourceExperimentId must reference a dev experiment`,
        ).toBe(true);
      }
    }

    for (const result of DEV_RELEASE_RUN_RESULTS) {
      expect(sampleIds.has(result.sampleId), `${result.id} sampleId must reference a dev sample`).toBe(true);
    }
  });

  it('maps every release event prompt variable from an upstream field', () => {
    for (const event of DEV_RELEASE_EVENTS) {
      const mapping = variableMappingRecord(event.variableMapping);
      const promptVariables = promptVariableNames(event.promptVersionSnapshot);
      const promptVariableSet = new Set(promptVariables);

      expect(mapping.id, `${event.id} must map target id from the external ID field`).toBe(event.externalIdField);
      for (const variable of promptVariables) {
        expect(mapping[variable]?.trim(), `${event.id} must map prompt variable ${variable}`).toBeTruthy();
      }
      for (const target of Object.keys(mapping)) {
        if (target === 'id') continue;
        expect(promptVariableSet.has(target), `${event.id} maps unknown prompt variable ${target}`).toBe(true);
      }
    }
  });

  it('keeps release versions and events connected in chronological version order', () => {
    const lineIds = new Set(DEV_RELEASE_LINES.map((line) => line.id));
    const versionIds = new Set(DEV_RELEASE_VERSIONS.map((version) => version.id));
    const eventIds = new Set(DEV_RELEASE_EVENTS.map((event) => event.id));

    expect(
      DEV_RELEASE_VERSIONS.filter((version) => version.kind === 'production').map(
        (version) => version.productionVersionNumber,
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(
      DEV_RELEASE_VERSIONS.filter((version) => version.kind === 'candidate').map(
        (version) => version.targetProductionVersionNumber,
      ),
    ).toEqual([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(
      new Set(
        DEV_RELEASE_VERSIONS.map((version) =>
          version.kind === 'production'
            ? `production-${version.productionVersionNumber}`
            : `production-${version.targetProductionVersionNumber}`,
        ),
      ).size,
    ).toBeGreaterThan(8);
    expect(DEV_RELEASE_EVENTS.filter((event) => event.operation === 'config_changed')).toHaveLength(11);

    for (const version of DEV_RELEASE_VERSIONS) {
      expect(lineIds.has(version.releaseLineId), `${version.id} releaseLineId must reference a dev release line`).toBe(
        true,
      );
      if (version.promotedFromReleaseVersionId) {
        expect(
          versionIds.has(version.promotedFromReleaseVersionId),
          `${version.id} promotedFromReleaseVersionId must reference a dev version`,
        ).toBe(true);
      }
    }

    for (const event of DEV_RELEASE_EVENTS) {
      expect(lineIds.has(event.releaseLineId), `${event.id} releaseLineId must reference a dev release line`).toBe(
        true,
      );
      expect(versionIds.has(event.releaseVersionId), `${event.id} releaseVersionId must reference a dev version`).toBe(
        true,
      );
      if (event.sourceEventId) {
        expect(eventIds.has(event.sourceEventId), `${event.id} sourceEventId must reference a dev event`).toBe(true);
      }
      if (event.supersedesEventId) {
        expect(eventIds.has(event.supersedesEventId), `${event.id} supersedesEventId must reference a dev event`).toBe(
          true,
        );
      }
    }
  });

  it('seeds release quality metrics for overall and concrete classification scopes', () => {
    const lanesWithQuality = new Set<string>();

    for (const event of DEV_RELEASE_EVENTS) {
      expect(isRecord(event.metrics), `${event.id} metrics must be present`).toBe(true);
      if (!isRecord(event.metrics)) continue;

      const quality = event.metrics.quality;
      expect(isRecord(quality), `${event.id} metrics.quality must be present`).toBe(true);
      if (!isRecord(quality)) continue;
      lanesWithQuality.add(event.laneType);

      expectQualityMetricSet(quality.overall, `${event.id}.quality.overall`);

      expect(Array.isArray(quality.scopes), `${event.id}.quality.scopes must be an array`).toBe(true);
      if (!Array.isArray(quality.scopes)) continue;
      expect(quality.scopes.map((scope) => (isRecord(scope) ? scope.key : null))).toEqual(['positive', 'negative']);
      for (const scope of quality.scopes) {
        expect(isRecord(scope), `${event.id}.quality.scope must be an object`).toBe(true);
        if (!isRecord(scope)) continue;
        expectQualityMetricSet(scope.metrics, `${event.id}.quality.scopes.${String(scope.key)}`);
      }
    }

    expect(lanesWithQuality).toEqual(new Set(['canary', 'production']));
  });

  it('connects release run results and annotation tasks', () => {
    const versionIds = new Set(DEV_RELEASE_VERSIONS.map((version) => version.id));
    const eventIds = new Set(DEV_RELEASE_EVENTS.map((event) => event.id));
    const resultIds = new Set(DEV_RELEASE_RUN_RESULTS.map((result) => result.id));
    const taskIds = new Set(DEV_RELEASE_ANNOTATION_TASKS.map((task) => task.id));

    for (const result of DEV_RELEASE_RUN_RESULTS) {
      expect(eventIds.has(result.sourceId), `${result.id} sourceId must reference a dev release event`).toBe(true);
      expect(
        versionIds.has(result.releaseVersionId),
        `${result.id} releaseVersionId must reference a dev release version`,
      ).toBe(true);
    }

    for (const task of DEV_RELEASE_ANNOTATION_TASKS) {
      expect(
        eventIds.has(task.releaseLineEventId),
        `${task.id} releaseLineEventId must reference a dev release event`,
      ).toBe(true);
      expect(
        versionIds.has(task.releaseVersionId),
        `${task.id} releaseVersionId must reference a dev release version`,
      ).toBe(true);
    }

    for (const annotation of DEV_RELEASE_ANNOTATIONS) {
      expect(
        resultIds.has(annotation.runResultId),
        `${annotation.id} runResultId must reference a dev run result`,
      ).toBe(true);
      expect(taskIds.has(annotation.taskId), `${annotation.id} taskId must reference a dev annotation task`).toBe(true);
    }
  });
});
