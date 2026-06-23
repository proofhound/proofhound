import { describe, expect, it } from 'vitest';
import { MODEL_PRESET_GROUPS, MODEL_PRESETS, createProjectModelSchema } from '.';

describe('model presets', () => {
  it('covers every quick-create provider group with at least one featured model', () => {
    for (const group of MODEL_PRESET_GROUPS) {
      const groupPresets = MODEL_PRESETS.filter((preset) => preset.group === group.key);
      expect(groupPresets.length, group.key).toBeGreaterThan(0);
      expect(
        groupPresets.some((preset) => preset.featured),
        group.key,
      ).toBe(true);
    }
  });

  it('can be converted into a local model create DTO', () => {
    for (const preset of MODEL_PRESETS) {
      const parsed = createProjectModelSchema.safeParse({
        name: preset.name,
        providerType: preset.providerType,
        providerModelId: preset.providerModelId,
        endpoint: preset.endpoint,
        apiKey: 'test-api-key',
        contextWindowTokens: preset.contextWindowTokens,
        rpm: { limit: preset.rpmLimit },
        tpm: { limit: preset.tpmLimit },
        concurrency: { limit: preset.concurrencyLimit },
        pricing: {
          inputPerMillion: preset.inputTokenPricePerMillion,
          outputPerMillion: preset.outputTokenPricePerMillion,
        },
        capabilities: preset.capabilities,
        extraBody: preset.extraBody ?? {},
      });

      expect(parsed.success, preset.key).toBe(true);
    }
  });

  it('uses providerType as an invocation protocol, not a vendor name', () => {
    for (const preset of MODEL_PRESETS) {
      expect(['openai', 'anthropic'], preset.key).toContain(preset.providerType);
    }
  });
});
