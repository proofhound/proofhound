import type { DatasetFieldSchemaDto } from '@proofhound/shared';
import { describe, expect, it } from 'vitest';
import { projectDatasetSample } from '../dataset-sample-projection';

const schema: DatasetFieldSchemaDto[] = [
  { name: 'question', role: 'text', type: 'string' },
  { name: 'label', role: 'expected_output', type: 'string' },
  { name: 'difficulty', role: 'metadata', type: 'string' },
  { name: 'photo', role: 'image_url', type: 'string' },
];

describe('projectDatasetSample', () => {
  it('pulls expected_output_scalar from the expected_output role field', () => {
    const p = projectDatasetSample({ question: 'q', label: 'positive', difficulty: 'easy' }, schema);
    expect(p.expectedOutputScalar).toBe('positive');
  });

  it('collects non-image short scalars into index_values for distribution / filtering', () => {
    const p = projectDatasetSample({ question: 'q', label: 'positive', difficulty: 'easy', photo: 'http://x/p.png' }, schema);
    expect(p.indexValues).toEqual({ question: 'q', label: 'positive', difficulty: 'easy' }); // photo (image) excluded
  });

  it('builds a search preview from the whole sample', () => {
    const p = projectDatasetSample({ question: 'hello', label: 'x' }, schema);
    expect(p.searchPreview).toBe(JSON.stringify({ question: 'hello', label: 'x' }));
  });

  it('skips oversized strings from scalars / index_values', () => {
    const big = 'a'.repeat(500);
    const p = projectDatasetSample({ question: big, label: big }, schema);
    expect(p.expectedOutputScalar).toBeNull(); // label too long
    expect(p.indexValues).toBeNull(); // both fields too long → no index values
  });

  it('keeps label/category scalars reserved (no role source)', () => {
    const p = projectDatasetSample({ label: 'x' }, schema);
    expect(p.labelScalar).toBeNull();
    expect(p.categoryScalar).toBeNull();
  });

  it('returns an all-null projection for null data', () => {
    expect(projectDatasetSample(null, schema)).toEqual({
      searchPreview: null,
      expectedOutputScalar: null,
      labelScalar: null,
      categoryScalar: null,
      indexValues: null,
    });
  });
});
