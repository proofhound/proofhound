import type { DatasetField, ProjectDataset } from '../datasets/dataset-types';
import type { PromptVariable, PromptVariableType } from './prompt-model';

function getVariableType(field: DatasetField): PromptVariableType | null {
  if (field.role === 'image') return 'image';
  if (field.role !== 'text') return null;
  if (field.preview === 'number') return 'number';
  return 'text';
}

export function toPromptVariablesFromDataset(dataset: ProjectDataset): PromptVariable[] {
  return dataset.fields
    .map((field) => {
      const type = getVariableType(field);
      if (!type) return null;

      return {
        name: field.name,
        type,
        required: true,
        description: field.hint ?? field.preview,
        datasetField: field.name,
        selected: true,
      };
    })
    .filter((variable): variable is PromptVariable => Boolean(variable));
}
