import { describe, expect, it } from 'vitest';

import {
  FLEX_MIN_PX_DEFAULT,
  WIDTH_PRESETS_PX,
  computeColumnLayout,
  resolveColumnPx,
  shouldStopCellClickPropagation,
  type TableColumn,
} from './table';

describe('resolveColumnPx', () => {
  it('maps each fixed preset to its px constant', () => {
    expect(resolveColumnPx({ width: 'narrow' })).toBe(WIDTH_PRESETS_PX.narrow);
    expect(resolveColumnPx({ width: 'compact' })).toBe(WIDTH_PRESETS_PX.compact);
    expect(resolveColumnPx({ width: 'normal' })).toBe(WIDTH_PRESETS_PX.normal);
    expect(resolveColumnPx({ width: 'wide' })).toBe(WIDTH_PRESETS_PX.wide);
  });

  it('uses FLEX_MIN_PX_DEFAULT for flex columns without minPx', () => {
    expect(resolveColumnPx({ width: 'flex' })).toBe(FLEX_MIN_PX_DEFAULT);
  });

  it('uses custom minPx for flex columns when provided', () => {
    expect(resolveColumnPx({ width: 'flex', minPx: 320 })).toBe(320);
  });
});

describe('computeColumnLayout', () => {
  it('accumulates sticky-left offsets across consecutive left-sticky columns', () => {
    const cols: TableColumn[] = [
      { key: 'select', width: 'narrow', sticky: 'left' },
      { key: 'name', width: 'wide', sticky: 'left' },
      { key: 'status', width: 'compact' },
    ];
    const layout = computeColumnLayout(cols);

    expect(layout.columnsByKey['select']!.leftOffsetPx).toBe(0);
    expect(layout.columnsByKey['name']!.leftOffsetPx).toBe(WIDTH_PRESETS_PX.narrow);
    expect(layout.columnsByKey['status']!.leftOffsetPx).toBeUndefined();
  });

  it('accumulates sticky-right offsets from the right edge', () => {
    const cols: TableColumn[] = [
      { key: 'name', width: 'wide' },
      { key: 'meta', width: 'normal', sticky: 'right' },
      { key: 'actions', width: 'narrow', sticky: 'right' },
    ];
    const layout = computeColumnLayout(cols);

    expect(layout.columnsByKey['actions']!.rightOffsetPx).toBe(0);
    expect(layout.columnsByKey['meta']!.rightOffsetPx).toBe(WIDTH_PRESETS_PX.narrow);
  });

  it('computes minWidthPx as the sum of all column widths including flex minPx', () => {
    const cols: TableColumn[] = [
      { key: 'select', width: 'narrow' }, //  48
      { key: 'name', width: 'wide' }, //     280
      { key: 'progress', width: 'flex', minPx: 220 }, // 220
      { key: 'actions', width: 'compact' }, // 120
    ];
    const layout = computeColumnLayout(cols);
    expect(layout.minWidthPx).toBe(48 + 280 + 220 + 120);
  });

  it('preserves column order via the columns array and indexes them', () => {
    const cols: TableColumn[] = [
      { key: 'a', width: 'compact' },
      { key: 'b', width: 'normal' },
      { key: 'c', width: 'wide' },
    ];
    const layout = computeColumnLayout(cols);
    expect(layout.columns.map((c) => c.key)).toEqual(['a', 'b', 'c']);
    expect(layout.columns.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('builds columnsByKey lookup containing every input column', () => {
    const cols: TableColumn[] = [
      { key: 'one', width: 'narrow' },
      { key: 'two', width: 'flex', minPx: 200 },
    ];
    const layout = computeColumnLayout(cols);
    expect(Object.keys(layout.columnsByKey).sort()).toEqual(['one', 'two']);
    expect(layout.columnsByKey['two']!.px).toBe(200);
  });
});

describe('shouldStopCellClickPropagation', () => {
  it('lets frozen content columns bubble row clicks by default', () => {
    expect(shouldStopCellClickPropagation({ key: 'name', sticky: 'left' })).toBe(false);
  });

  it('stops row clicks for select and actions columns by default', () => {
    expect(shouldStopCellClickPropagation({ key: 'select', sticky: 'left' })).toBe(true);
    expect(shouldStopCellClickPropagation({ key: 'actions', sticky: 'right' })).toBe(true);
  });

  it('honors explicit overrides', () => {
    expect(shouldStopCellClickPropagation({ key: 'name', sticky: 'left' }, true)).toBe(true);
    expect(shouldStopCellClickPropagation({ key: 'actions', sticky: 'right' }, false)).toBe(false);
  });
});
