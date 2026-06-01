import { describe, expect, it } from 'vitest';

import {
  getImageReferences,
  getImageSourceType,
  getPrimaryImageReference,
  inferMissingFieldRole,
  mergeFieldsWithSampleData,
  normalizeExpectedRoles,
  parseImageReferenceArrayInput,
} from './dataset-detail-helpers';
import type { DatasetField, DatasetSample } from './dataset-types';

describe('getImageSourceType', () => {
  it('returns empty for blank strings', () => {
    expect(getImageSourceType('')).toBe('empty');
    expect(getImageSourceType('   ')).toBe('empty');
  });

  it('detects http(s) URLs', () => {
    expect(getImageSourceType('https://x.com/a.png')).toBe('url');
    expect(getImageSourceType('http://x/a.jpg?q=1')).toBe('url');
    expect(getImageSourceType('  https://x/a  ')).toBe('url');
    expect(getImageSourceType(['https://x/a.png', 'https://x/b.png'])).toBe('url');
  });

  it('detects base64 data URLs', () => {
    expect(getImageSourceType('data:image/png;base64,iVBORw0KGgo')).toBe('base64');
    expect(getImageSourceType('data:image/jpeg;base64,abc')).toBe('base64');
  });

  it('falls back to file for anything else', () => {
    expect(getImageSourceType('a.png')).toBe('file');
    expect(getImageSourceType('/local/path/img.jpg')).toBe('file');
  });
});

describe('image reference arrays', () => {
  it('extracts image references from arrays and JSON array strings', () => {
    const json = '["https://example.test/a,b.png?x=1;2","data:image/png;base64,iVBORw0KGgo="]';

    expect(getImageReferences(json)).toEqual([
      'https://example.test/a,b.png?x=1;2',
      'data:image/png;base64,iVBORw0KGgo=',
    ]);
    expect(getPrimaryImageReference(json)).toBe('https://example.test/a,b.png?x=1;2');
    expect(parseImageReferenceArrayInput(json)).toEqual([
      'https://example.test/a,b.png?x=1;2',
      'data:image/png;base64,iVBORw0KGgo=',
    ]);
  });

  it('does not parse delimiter-separated strings as multi-image values', () => {
    const value = 'https://example.test/a,b.png;https://example.test/b.png';

    expect(getImageReferences(value)).toEqual([value]);
    expect(parseImageReferenceArrayInput(value)).toBeNull();
  });
});

describe('inferMissingFieldRole', () => {
  it('returns id only for id / sample_id (case-insensitive)', () => {
    expect(inferMissingFieldRole('id')).toBe('id');
    expect(inferMissingFieldRole('ID')).toBe('id');
    expect(inferMissingFieldRole('sample_id')).toBe('id');
    expect(inferMissingFieldRole('Sample_ID')).toBe('id');
  });

  it('never returns expected from name heuristics (would break expected_output uniqueness)', () => {
    for (const name of [
      'label',
      'expected',
      'expected_output',
      'answer',
      'target',
      'ground_truth',
      'gold',
      'my_label',
      'sentiment_label',
    ]) {
      expect(inferMissingFieldRole(name)).toBe('metadata');
    }
  });

  it('falls back to metadata for unknown names', () => {
    expect(inferMissingFieldRole('image_url')).toBe('metadata');
    expect(inferMissingFieldRole('question')).toBe('metadata');
    expect(inferMissingFieldRole('whatever')).toBe('metadata');
  });
});

describe('mergeFieldsWithSampleData', () => {
  const field = (name: string, role: DatasetField['role']): DatasetField => ({ name, role, preview: '' });
  const sample = (data: Record<string, unknown>): DatasetSample => ({ id: data.sample_id as string, data });

  it('appends sample-only fields as metadata, never expected', () => {
    const fields: DatasetField[] = [
      field('sample_id', 'id'),
      field('text', 'text'),
      field('expected_output', 'expected'),
    ];
    const samples = [sample({ sample_id: 'a', text: 't', expected_output: 'pos', label: 1, target: 'x' })];

    const merged = mergeFieldsWithSampleData(fields, samples);

    const labelField = merged.find((f) => f.name === 'label');
    const targetField = merged.find((f) => f.name === 'target');
    expect(labelField?.role).toBe('metadata');
    expect(targetField?.role).toBe('metadata');

    const expectedCount = merged.filter((f) => f.role === 'expected').length;
    expect(expectedCount).toBe(1);
  });

  it('does not duplicate known fields', () => {
    const fields: DatasetField[] = [field('sample_id', 'id'), field('label', 'metadata')];
    const samples = [sample({ sample_id: 'a', label: 0 })];
    const merged = mergeFieldsWithSampleData(fields, samples);
    expect(merged).toHaveLength(2);
  });
});

describe('normalizeExpectedRoles', () => {
  const field = (name: string, role: DatasetField['role']): DatasetField => ({ name, role, preview: '' });

  it('keeps single expected as-is', () => {
    const fields = [field('a', 'metadata'), field('expected_output', 'expected')];
    expect(normalizeExpectedRoles(fields, 'expected_output')).toEqual(fields);
  });

  it('downgrades extra expected fields to metadata, prefers preferredName', () => {
    const fields = [field('expected_output', 'expected'), field('label', 'expected'), field('text', 'text')];
    const out = normalizeExpectedRoles(fields, 'expected_output');
    expect(out.find((f) => f.name === 'expected_output')?.role).toBe('expected');
    expect(out.find((f) => f.name === 'label')?.role).toBe('metadata');
    expect(out.filter((f) => f.role === 'expected')).toHaveLength(1);
  });

  it('falls back to first expected when preferredName missing / not expected', () => {
    const fields = [field('label', 'expected'), field('target', 'expected')];
    const out = normalizeExpectedRoles(fields, 'expected_output');
    expect(out.find((f) => f.name === 'label')?.role).toBe('expected');
    expect(out.find((f) => f.name === 'target')?.role).toBe('metadata');
  });

  it('returns input untouched when no expected present', () => {
    const fields = [field('text', 'text'), field('label', 'metadata')];
    expect(normalizeExpectedRoles(fields, null)).toEqual(fields);
  });
});
