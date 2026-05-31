import { describe, expect, it } from 'vitest';

import { formatProgressLabel, formatProgressNumber, getProgressPercent } from './progress';

describe('getProgressPercent', () => {
  it('returns value/max as percent within [0, 100]', () => {
    expect(getProgressPercent(0, 100)).toBe(0);
    expect(getProgressPercent(50, 100)).toBe(50);
    expect(getProgressPercent(100, 100)).toBe(100);
    expect(getProgressPercent(25, 200)).toBe(12.5);
  });

  it('clamps negative values to 0 and overflow to 100', () => {
    expect(getProgressPercent(-10, 100)).toBe(0);
    expect(getProgressPercent(250, 100)).toBe(100);
  });

  it('falls back to max=100 when max is invalid', () => {
    expect(getProgressPercent(50, 0)).toBe(50);
    expect(getProgressPercent(50, -5)).toBe(50);
    expect(getProgressPercent(50, Number.NaN)).toBe(50);
    expect(getProgressPercent(50, Number.POSITIVE_INFINITY)).toBe(50);
  });

  it('returns 0 when value is not finite', () => {
    expect(getProgressPercent(Number.NaN, 100)).toBe(0);
    expect(getProgressPercent(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });
});

describe('formatProgressNumber', () => {
  it('formats whole numbers with thin-space thousand grouping', () => {
    expect(formatProgressNumber(0)).toBe('0');
    expect(formatProgressNumber(1234)).toBe('1 234');
    expect(formatProgressNumber(1234567)).toBe('1 234 567');
  });

  it('returns em dash for non-finite numbers', () => {
    expect(formatProgressNumber(Number.NaN)).toBe('—');
    expect(formatProgressNumber(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatProgressLabel', () => {
  it('outputs "percent · value / max" with default zero fraction digits', () => {
    expect(formatProgressLabel({ value: 45, max: 100 })).toBe('45% · 45 / 100');
  });

  it('respects fractionDigits', () => {
    expect(formatProgressLabel({ value: 33, max: 100, fractionDigits: 1 })).toBe('33.0% · 33 / 100');
    expect(formatProgressLabel({ value: 1, max: 3, fractionDigits: 2 })).toBe('33.33% · 1 / 3');
  });

  it('uses provided percent when given, else computes from value/max', () => {
    expect(formatProgressLabel({ value: 10, max: 100, percent: 50 })).toBe('50% · 10 / 100');
    expect(formatProgressLabel({ value: 200, max: 100, percent: 999 })).toBe('100% · 200 / 100');
  });

  it('uses custom valueLabel / maxLabel when provided', () => {
    expect(
      formatProgressLabel({
        value: 1500000,
        max: 5000000,
        fractionDigits: 1,
        valueLabel: '1.5 MB',
        maxLabel: '5 MB',
      }),
    ).toBe('30.0% · 1.5 MB / 5 MB');
  });

  it('formats large value/max with thousand grouping by default', () => {
    expect(formatProgressLabel({ value: 1234, max: 10000 })).toBe('12% · 1 234 / 10 000');
  });
});
