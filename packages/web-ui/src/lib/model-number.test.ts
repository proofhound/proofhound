import { describe, expect, it } from 'vitest';
import { toIntegerInputValue } from './model-number';

describe('toIntegerInputValue', () => {
  it('preserves -1 as the unlimited RPM/TPM sentinel', () => {
    expect(toIntegerInputValue('-1')).toBe('-1');
    expect(toIntegerInputValue(' -1 ')).toBe('-1');
  });

  it('still expands compact k/m values for normal limits', () => {
    expect(toIntegerInputValue('1.5k')).toBe('1500');
    expect(toIntegerInputValue('2 M')).toBe('2000000');
  });
});
