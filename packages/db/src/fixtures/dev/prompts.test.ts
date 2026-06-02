import { describe, expect, it } from 'vitest';
import { DEV_PROMPTS } from './prompts';

describe('DEV_PROMPTS', () => {
  it('every prompt version must start at v1 and stay sequential', () => {
    for (const fixture of DEV_PROMPTS) {
      const versions = fixture.versions.map((version) => version.versionNumber).sort((left, right) => left - right);

      expect(versions[0], `${fixture.name} must start at v1`).toBe(1);

      versions.forEach((version, index) => {
        expect(version, `${fixture.name} version numbers must be sequential`).toBe(index + 1);
      });
    }
  });

  it('the current online version must exist in the version list', () => {
    for (const fixture of DEV_PROMPTS) {
      if (!fixture.currentOnlineVersionId) continue;
      expect(
        fixture.versions.some((version) => version.id === fixture.currentOnlineVersionId),
        `${fixture.name} currentOnlineVersionId is not in versions`,
      ).toBe(true);
    }
  });

  it('every prompt is bound to a default dataset (so the editor auto-loads it on open)', () => {
    for (const fixture of DEV_PROMPTS) {
      expect(
        fixture.defaultDatasetId,
        `${fixture.name} is missing defaultDatasetId; the dataset will be unselected when the editor opens`,
      ).toBeTruthy();
    }
  });
});
