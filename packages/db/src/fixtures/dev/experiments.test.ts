import { describe, expect, it } from 'vitest';
import { DEV_EXPERIMENT_DATASETS } from './experiments';

describe('DEV_EXPERIMENT_DATASETS', () => {
  it('every dataset sampleCount must equal the actual samples.length', () => {
    for (const fixture of DEV_EXPERIMENT_DATASETS) {
      expect(fixture.sampleCount, `${fixture.name} sampleCount does not match samples.length`).toBe(fixture.samples.length);
    }
  });

  it('every dataset contains at most 1 expected_output field', () => {
    for (const fixture of DEV_EXPERIMENT_DATASETS) {
      const expectedOutputCount = fixture.fieldSchema.filter((field) => field.role === 'expected_output').length;
      expect(
        expectedOutputCount,
        `${fixture.name} has ${expectedOutputCount} expected_output fields`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('current dev datasets exist and satisfy the constraints', () => {
    expect(DEV_EXPERIMENT_DATASETS.length).toBeGreaterThan(0);

    for (const dataset of DEV_EXPERIMENT_DATASETS) {
      expect(dataset.samples.length, `${dataset.name} must contain samples`).toBeGreaterThan(0);
      expect(
        dataset.fieldSchema.some((field) => field.role === 'expected_output'),
        `${dataset.name} must declare an expected_output field`,
      ).toBe(true);
    }
  });

  it('each sample data field must be a subset of the fieldSchema field set', () => {
    for (const fixture of DEV_EXPERIMENT_DATASETS) {
      const allowed = new Set(fixture.fieldSchema.map((field) => field.name));
      for (const sample of fixture.samples) {
        const stray = Object.keys(sample.data).filter((key) => !allowed.has(key));
        expect(
          stray,
          `${fixture.name} sample ${sample.externalId} has fields not declared in fieldSchema: ${stray.join(',')}`,
        ).toEqual([]);
      }
    }
  });

  it('all fixture sample.id values are globally unique (avoid onConflict mismatches across datasets)', () => {
    const seen = new Map<string, string>();
    for (const fixture of DEV_EXPERIMENT_DATASETS) {
      for (const sample of fixture.samples) {
        const prev = seen.get(sample.id);
        expect(prev, `sample.id ${sample.id} is duplicated in ${prev} and ${fixture.name}`).toBeUndefined();
        seen.set(sample.id, fixture.name);
      }
    }
  });
});
