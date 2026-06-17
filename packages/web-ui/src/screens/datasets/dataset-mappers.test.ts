import { describe, expect, it } from 'vitest';
import type { DatasetListItemDto } from '@proofhound/shared';
import { toProjectDataset } from './dataset-mappers';

function makeDataset(overrides: Partial<DatasetListItemDto> = {}): DatasetListItemDto {
  return {
    id: 'd-1',
    projectId: 'p-1',
    name: 'demo',
    status: 'active',
    description: null,
    createdBy: 'u-1',
    createdByDisplayName: 'Alice',
    storagePrefix: 'datasets/p-1/demo.jsonl',
    fieldSchema: [],
    sampleCount: 0,
    hasImages: false,
    categoryDistribution: { field: null, total: 0, categories: [] },
    references: { experiments: 0, optimizations: 0 },
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('toProjectDataset - modalities derivation', () => {
  it('text-only dataset → modalities = ["text"]', () => {
    const ui = toProjectDataset(
      makeDataset({
        fieldSchema: [
          { name: 'text', role: 'text', type: 'string' },
          { name: 'expected_output', role: 'expected_output', type: 'string' },
        ],
        hasImages: false,
      }),
    );
    expect(ui.modalities).toEqual(['text']);
    expect(ui.hasImages).toBe(false);
  });

  it('image-only dataset → modalities = ["image"]', () => {
    const ui = toProjectDataset(
      makeDataset({
        fieldSchema: [
          { name: 'sample_id', role: 'metadata', type: 'string' },
          { name: 'image_url', role: 'image_url', type: 'string' },
        ],
        hasImages: true,
      }),
    );
    expect(ui.modalities).toEqual(['image']);
    expect(ui.hasImages).toBe(true);
  });

  it('multimodal dataset (text + image) → modalities = ["text", "image"]', () => {
    const ui = toProjectDataset(
      makeDataset({
        fieldSchema: [
          { name: 'image_url', role: 'image_url', type: 'string' },
          { name: 'ocr_text', role: 'text', type: 'string' },
          { name: 'expected_output', role: 'expected_output', type: 'string' },
        ],
        hasImages: true,
      }),
    );
    expect(ui.modalities).toEqual(['text', 'image']);
    expect(ui.hasImages).toBe(true);
  });

  it('structural-only dataset (no text/image fields) → fallback to ["text"]', () => {
    const ui = toProjectDataset(
      makeDataset({
        fieldSchema: [
          { name: 'sample_id', role: 'metadata', type: 'string' },
          { name: 'expected_output', role: 'expected_output', type: 'string' },
        ],
        hasImages: false,
      }),
    );
    expect(ui.modalities).toEqual(['text']);
  });

  it('treats image / image_url / image_base64 roles all as image modality', () => {
    const imageOnlyBase64 = toProjectDataset(
      makeDataset({
        fieldSchema: [{ name: 'image_data', role: 'image_base64', type: 'string' }],
      }),
    );
    const imageOnlyPlain = toProjectDataset(
      makeDataset({
        fieldSchema: [{ name: 'image', role: 'image', type: 'string' }],
      }),
    );
    expect(imageOnlyBase64.modalities).toEqual(['image']);
    expect(imageOnlyPlain.modalities).toEqual(['image']);
  });
});
