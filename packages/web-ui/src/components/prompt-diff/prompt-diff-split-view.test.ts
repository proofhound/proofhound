import { describe, expect, it } from 'vitest';

import { buildPromptDiffRows, getDiffLineClasses } from './prompt-diff-split-view';

describe('buildPromptDiffRows', () => {
  it('treats two identical texts as all-same rows', () => {
    const rows = buildPromptDiffRows('a\nb\nc', 'a\nb\nc');
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.leftKind === 'same' && row.rightKind === 'same')).toBe(true);
  });

  it('marks new lines on the right as added and pads left with blank', () => {
    const rows = buildPromptDiffRows('a\nc', 'a\nb\nc');
    const addedRow = rows.find((row) => row.rightKind === 'added');
    expect(addedRow).toBeDefined();
    expect(addedRow?.right).toBe('b');
    expect(addedRow?.leftKind).toBe('blank');
    expect(addedRow?.left).toBe('');
  });

  it('marks dropped lines on the left as removed and pads right with blank', () => {
    const rows = buildPromptDiffRows('a\nb\nc', 'a\nc');
    const removedRow = rows.find((row) => row.leftKind === 'removed');
    expect(removedRow).toBeDefined();
    expect(removedRow?.left).toBe('b');
    expect(removedRow?.rightKind).toBe('blank');
    expect(removedRow?.right).toBe('');
  });

  it('handles entirely disjoint texts as add + remove rows', () => {
    const rows = buildPromptDiffRows('a', 'b');
    expect(rows.some((row) => row.leftKind === 'removed' && row.left === 'a')).toBe(true);
    expect(rows.some((row) => row.rightKind === 'added' && row.right === 'b')).toBe(true);
  });

  it('handles empty fromText: every right line is added', () => {
    const rows = buildPromptDiffRows('', 'x\ny');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const addedLines = rows.filter((row) => row.rightKind === 'added').map((row) => row.right);
    expect(addedLines).toEqual(expect.arrayContaining(['x', 'y']));
  });
});

describe('getDiffLineClasses', () => {
  it('returns themed token classes by kind', () => {
    expect(getDiffLineClasses('added')).toContain('var(--status-running');
    expect(getDiffLineClasses('removed')).toContain('destructive');
    expect(getDiffLineClasses('blank')).toContain('muted');
    expect(getDiffLineClasses('same')).toBe('text-foreground');
  });
});
