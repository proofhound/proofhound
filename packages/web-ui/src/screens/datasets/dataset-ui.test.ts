import { describe, expect, it } from 'vitest';

import { formatSize } from './dataset-ui';

describe('formatSize', () => {
  it('falls back to 0 B for invalid or non-positive input', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(-1)).toBe('0 B');
    expect(formatSize(Number.NaN)).toBe('0 B');
    expect(formatSize(Number.POSITIVE_INFINITY)).toBe('0 B');
  });

  it('renders sub-KB values in bytes', () => {
    expect(formatSize(0.0005)).toBe(`${Math.round(0.0005 * 1024 * 1024)} B`);
    expect(formatSize(1 / 1024 / 1024)).toBe('1 B');
  });

  it('renders sub-MB values in KB with one decimal', () => {
    expect(formatSize(0.5)).toBe('512.0 KB');
    expect(formatSize(0.1)).toBe('102.4 KB');
  });

  it('keeps MB formatting consistent with prior behaviour', () => {
    expect(formatSize(1)).toBe('1.0 MB');
    expect(formatSize(9.9)).toBe('9.9 MB');
    expect(formatSize(10)).toBe('10 MB');
    expect(formatSize(123.7)).toBe('124 MB');
  });

  it('renders >= 1 GB values in GB with two decimals', () => {
    expect(formatSize(1024)).toBe('1.00 GB');
    expect(formatSize(2048)).toBe('2.00 GB');
    expect(formatSize(1536)).toBe('1.50 GB');
  });
});
