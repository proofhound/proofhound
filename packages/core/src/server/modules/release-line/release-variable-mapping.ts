import { BadRequestException } from '@nestjs/common';
import { promptVariableSchema } from '@proofhound/shared';

type ReleaseVariableMappingInput = {
  variableMapping: unknown;
  promptVariables?: unknown;
  promptVersionSnapshot?: unknown;
  externalIdField?: string | null;
};

export function assertReleasePromptVariableMapping(input: ReleaseVariableMappingInput): void {
  const variables = extractPromptVariableNames(input.promptVariables ?? readSnapshotVariables(input.promptVersionSnapshot));
  if (variables.length === 0) return;

  const mapping = normalizeVariableMapping(input.variableMapping);
  const variableSet = new Set(variables);
  const unknownTargets = Array.from(mapping.targets).filter((target) => target !== 'id' && !variableSet.has(target));
  if (unknownTargets.length > 0) {
    throw new BadRequestException(`release_variable_mapping_unknown_prompt_variables:${unknownTargets.join(',')}`);
  }

  if (mapping.duplicateTargets.length > 0) {
    throw new BadRequestException(`release_variable_mapping_duplicate_targets:${mapping.duplicateTargets.join(',')}`);
  }

  const missingTargets = variables.filter((variable) => !mapping.byTarget.get(variable)?.trim());
  if (missingTargets.length > 0) {
    throw new BadRequestException(`release_variable_mapping_missing_prompt_variables:${missingTargets.join(',')}`);
  }

  const externalIdField = input.externalIdField?.trim();
  const mappedExternalIdField = mapping.byTarget.get('id')?.trim();
  if (externalIdField && mappedExternalIdField && mappedExternalIdField !== externalIdField) {
    throw new BadRequestException('release_variable_mapping_external_id_mismatch');
  }
}

function readSnapshotVariables(snapshot: unknown): unknown {
  if (!isRecord(snapshot)) return [];
  return snapshot['variables'];
}

function extractPromptVariableNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const variables: string[] = [];
  for (const item of value) {
    const parsed = promptVariableSchema.safeParse(item);
    if (!parsed.success) continue;
    const name = parsed.data.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    variables.push(name);
  }
  return variables;
}

function normalizeVariableMapping(value: unknown): {
  byTarget: Map<string, string>;
  targets: Set<string>;
  duplicateTargets: string[];
} {
  const byTarget = new Map<string, string>();
  const targets = new Set<string>();
  const duplicates = new Set<string>();

  const add = (targetValue: unknown, sourceValue: unknown) => {
    if (typeof targetValue !== 'string' || typeof sourceValue !== 'string') return;
    const target = targetValue.trim();
    const source = sourceValue.trim();
    if (!target) return;
    if (targets.has(target)) duplicates.add(target);
    targets.add(target);
    byTarget.set(target, source);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item)) continue;
      add(item['target'], item['source']);
    }
  } else if (isRecord(value)) {
    for (const [target, source] of Object.entries(value)) add(target, source);
  }

  return { byTarget, targets, duplicateTargets: Array.from(duplicates) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
