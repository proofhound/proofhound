import { describe, expect, it } from 'vitest';
import type { PromptVariable } from './prompt-model';
import { countPromptVariableUsages, renderPromptPreviewParts } from './prompt-preview-parts';

const variable = (name: string, type: PromptVariable['type'] = 'text'): PromptVariable => ({
  name,
  type,
  required: true,
  description: '',
  datasetField: name,
  selected: true,
});

describe('renderPromptPreviewParts', () => {
  it('returns a single text part when no variables present', () => {
    const parts = renderPromptPreviewParts('Hello world', []);
    expect(parts).toEqual([{ kind: 'text', value: 'Hello world', name: '' }]);
  });

  it('returns an empty array for empty input', () => {
    expect(renderPromptPreviewParts('', [])).toEqual([]);
  });

  it('splits a single variable with surrounding text', () => {
    const parts = renderPromptPreviewParts('Hi {{name}}!', [variable('name')]);
    expect(parts).toEqual([
      { kind: 'text', value: 'Hi ', name: '' },
      { kind: 'var', value: '{{name}}', name: 'name', varType: 'text' },
      { kind: 'text', value: '!', name: '' },
    ]);
  });

  it('keeps adjacent variables separated', () => {
    const parts = renderPromptPreviewParts('{{a}}{{b}}', [variable('a'), variable('b', 'number')]);
    expect(parts.map((p) => p.kind)).toEqual(['var', 'var']);
    const second = parts[1];
    expect(second && second.kind === 'var' ? second.varType : null).toBe('number');
  });

  it('marks unknown variable names with undefined varType', () => {
    const parts = renderPromptPreviewParts('{{unknown}}', [variable('declared')]);
    const head = parts[0];
    expect(head?.kind).toBe('var');
    if (head?.kind === 'var') {
      expect(head.name).toBe('unknown');
      expect(head.varType).toBeUndefined();
    }
  });

  it('preserves trailing text after the last variable', () => {
    const parts = renderPromptPreviewParts('{{x}} done', [variable('x')]);
    expect(parts.at(-1)).toEqual({ kind: 'text', value: ' done', name: '' });
  });
});

describe('countPromptVariableUsages', () => {
  it('counts declared variables in the prompt body', () => {
    const counts = countPromptVariableUsages('Hi {{name}}, {{ name }} scored {{score}}. {{unknown}}', [
      variable('name'),
      variable('score', 'number'),
    ]);

    expect(counts.get('name')).toBe(2);
    expect(counts.get('score')).toBe(1);
    expect(counts.has('unknown')).toBe(false);
  });

  it('returns zero for declared variables that are not referenced', () => {
    const counts = countPromptVariableUsages('No variables here', [variable('name')]);

    expect(counts.get('name')).toBe(0);
  });
});
