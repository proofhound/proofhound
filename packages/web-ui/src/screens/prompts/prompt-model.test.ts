import { describe, expect, it } from 'vitest';
import type { PromptDetailDto } from '@proofhound/shared';
import { serializeJudgmentRules, syncJudgmentRulesWithBinding, toProjectPrompt } from './prompt-model';

const version = {
  id: '11111111-1111-4111-8111-111111111111',
  promptId: '22222222-2222-4222-8222-222222222222',
  versionNumber: 1,
  status: 'editable' as const,
  body: 'Classify {{text}}',
  variables: [{ name: 'text', type: 'text' as const, required: true, datasetField: 'review' }],
  outputSchema: { fields: [{ key: 'label', value: 'good 或 bad', isJudgment: true }] },
  judgmentRules: { mode: 'exact_match', decision_field: 'label', expected_field: 'gold_label' },
  promptLanguage: 'zh-CN' as const,
  parentVersionId: null,
  generatedByOptimizationId: null,
  changeReason: null,
  labels: [],
  isFrozen: false,
  createdBy: '33333333-3333-4333-8333-333333333333',
  createdByDisplayName: 'Alice',
  createdAt: '2026-06-22T00:00:00.000Z',
  frozenAt: null,
};

const prompt = {
  id: '22222222-2222-4222-8222-222222222222',
  projectId: '44444444-4444-4444-8444-444444444444',
  name: 'Sentiment',
  status: 'active',
  defaultDatasetId: '55555555-5555-4555-8555-555555555555',
  defaultDatasetName: 'reviews',
  latestVersionNumber: 1,
  currentOnlineVersionNumber: null,
  currentCanaryVersionNumber: null,
  customLabels: [],
  latestVersionStatus: 'editable',
  createdBy: '33333333-3333-4333-8333-333333333333',
  createdByDisplayName: 'Alice',
  createdAt: '2026-06-22T00:00:00.000Z',
  updatedAt: '2026-06-22T00:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  activeReferences: 0,
  versions: [version],
} as unknown as PromptDetailDto;

describe('prompt model judgment rules', () => {
  it('normalizes legacy prompt rules for the frontend model', () => {
    const model = toProjectPrompt(prompt);

    expect(model.versions[0]?.judgmentRules).toEqual([
      {
        id: 'rule-1',
        decisionField: 'label',
        expectedField: 'gold_label',
        operator: 'exact_match',
        description: '',
      },
    ]);
  });

  it('serializes dataset-bound rules in canonical shape', () => {
    const rules = syncJudgmentRulesWithBinding([], {
      decisionField: 'label',
      expectedField: 'expected_label',
    });

    expect(serializeJudgmentRules(rules)).toEqual({
      rules: [{ decisionField: 'label', expectedField: 'expected_label', operator: 'exact_match' }],
    });
  });
});
