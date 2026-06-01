import { describe, expect, it } from 'vitest';

import { MODALITY_KIND_ORDER, sortModalityKinds, type ModalityKind } from './modality-icon';

describe('MODALITY_KIND_ORDER', () => {
  it('puts text before image before number', () => {
    expect(MODALITY_KIND_ORDER.text).toBeLessThan(MODALITY_KIND_ORDER.image);
    expect(MODALITY_KIND_ORDER.image).toBeLessThan(MODALITY_KIND_ORDER.number);
  });
});

describe('sortModalityKinds', () => {
  it('returns text → image → number regardless of input order', () => {
    expect(sortModalityKinds(['image', 'text'])).toEqual<ModalityKind[]>(['text', 'image']);
    expect(sortModalityKinds(['number', 'image', 'text'])).toEqual<ModalityKind[]>([
      'text',
      'image',
      'number',
    ]);
    expect(sortModalityKinds(['number', 'text'])).toEqual<ModalityKind[]>(['text', 'number']);
  });

  it('deduplicates repeated kinds', () => {
    expect(sortModalityKinds(['image', 'image', 'text', 'image'])).toEqual<ModalityKind[]>([
      'text',
      'image',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(sortModalityKinds([])).toEqual([]);
  });

  it('returns single-kind array unchanged', () => {
    expect(sortModalityKinds(['image'])).toEqual<ModalityKind[]>(['image']);
    expect(sortModalityKinds(['number'])).toEqual<ModalityKind[]>(['number']);
  });
});
