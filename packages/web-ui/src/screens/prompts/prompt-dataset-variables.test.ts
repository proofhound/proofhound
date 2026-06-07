import { describe, expect, it } from 'vitest';
import type { ProjectDataset } from '../datasets/dataset-types';
import { toPromptVariablesFromDataset } from './prompt-dataset-variables';

function makeDataset(fields: ProjectDataset['fields']): ProjectDataset {
  return {
    id: 'dataset-1',
    name: 'Dataset',
    description: '',
    owner: 'owner',
    uploadSource: 'local.jsonl',
    modalities: ['text', 'image'],
    hasImages: true,
    status: 'active',
    sampleCount: 1,
    sizeMb: 0,
    fieldCount: fields.length,
    categoryProfile: { slices: [] },
    references: { experiments: 0, optimizations: 0 },
  createdAt: '2026/05/18 00:00:00',
  updatedAt: '2026/05/18 00:00:00',
  createdAtRaw: '2026-05-18T00:00:00.000Z',
  updatedAtRaw: '2026-05-18T00:00:00.000Z',
    fields,
  };
}

describe('toPromptVariablesFromDataset', () => {
  it('derives prompt variables from prompt-capable dataset fields only', () => {
    const variables = toPromptVariablesFromDataset(
      makeDataset([
        { name: 'sample_id', role: 'id', preview: 'string' },
        { name: 'text', role: 'text', preview: 'string', hint: 'review text' },
        { name: 'score', role: 'text', preview: 'number' },
        { name: 'image_url', role: 'image', preview: 'string' },
        { name: 'expected_output', role: 'expected', preview: 'string' },
        { name: 'source', role: 'metadata', preview: 'string' },
      ]),
    );

    expect(variables).toEqual([
      {
        name: 'text',
        type: 'text',
        required: true,
        description: 'review text',
        datasetField: 'text',
        selected: true,
      },
      {
        name: 'score',
        type: 'number',
        required: true,
        description: 'number',
        datasetField: 'score',
        selected: true,
      },
      {
        name: 'image_url',
        type: 'image',
        required: true,
        description: 'string',
        datasetField: 'image_url',
        selected: true,
      },
    ]);
  });
});
