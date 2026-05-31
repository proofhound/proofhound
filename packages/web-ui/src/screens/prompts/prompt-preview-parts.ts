import type { PromptVariable } from './prompt-model';

type PromptPreviewVariable = Pick<PromptVariable, 'name' | 'type'>;

export interface PromptPreviewPart {
  kind: 'text' | 'var';
  value: string;
  name: string;
  varType?: PromptVariable['type'];
}

export function renderPromptPreviewParts(
  preview: string,
  variables: ReadonlyArray<PromptPreviewVariable>,
): PromptPreviewPart[] {
  const variableTypes = new Map<string, PromptVariable['type']>(variables.map((v) => [v.name, v.type]));
  const parts: PromptPreviewPart[] = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(preview)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: 'text', value: preview.slice(lastIndex, match.index), name: '' });
    }
    const name = (match[1] ?? '').trim();
    parts.push({ kind: 'var', value: match[0], name, varType: variableTypes.get(name) });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < preview.length) {
    parts.push({ kind: 'text', value: preview.slice(lastIndex), name: '' });
  }
  return parts;
}

export function countPromptVariableUsages(
  template: string,
  variables: ReadonlyArray<PromptPreviewVariable>,
): Map<string, number> {
  const counts = new Map<string, number>(variables.map((variable) => [variable.name, 0]));
  const regex = /\{\{([^}]+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const name = (match[1] ?? '').trim();
    if (counts.has(name)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}
