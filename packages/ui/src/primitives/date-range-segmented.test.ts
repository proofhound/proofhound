import { describe, expect, it } from 'vitest';

import {
  buildCalendarDays,
  localDateTimePartsToIso,
  resolveDateRangePreset,
  resolveRollingDateRangeValue,
  toLocalDateTimeParts,
} from './date-range-segmented';

describe('resolveDateRangePreset', () => {
  it('resolves rolling presets from the provided clock', () => {
    const now = new Date('2026-05-20T12:00:00.000Z');

    expect(resolveDateRangePreset('h24', now)).toEqual({
      from: '2026-05-19T12:00:00.000Z',
      to: '2026-05-20T12:00:00.000Z',
    });
    expect(resolveDateRangePreset('custom', now)).toBeNull();
  });

  it('refreshes rolling values from a new clock', () => {
    const value = {
      preset: 'h1' as const,
      from: '2026-05-20T11:00:00.000Z',
      to: '2026-05-20T12:00:00.000Z',
    };

    expect(resolveRollingDateRangeValue(value, new Date('2026-05-20T12:30:00.000Z'))).toEqual({
      preset: 'h1',
      from: '2026-05-20T11:30:00.000Z',
      to: '2026-05-20T12:30:00.000Z',
    });
  });

  it('keeps custom values fixed when refreshed', () => {
    const value = {
      preset: 'custom' as const,
      from: '2026-05-18T08:00:00.000Z',
      to: '2026-05-20T12:00:00.000Z',
    };

    expect(resolveRollingDateRangeValue(value, new Date('2026-05-20T12:30:00.000Z'))).toBe(value);
  });
});

describe('local date-time conversion', () => {
  it('converts ISO values to local date and minute parts', () => {
    const iso = new Date(2026, 4, 20, 9, 30, 45).toISOString();

    expect(toLocalDateTimeParts(iso)).toEqual({ date: '2026-05-20', time: '09:30' });
  });

  it('converts local date and time parts back to ISO', () => {
    const iso = localDateTimePartsToIso({ date: '2026-05-20', time: '09:30' });
    expect(iso).not.toBeNull();

    const date = new Date(iso!);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(4);
    expect(date.getDate()).toBe(20);
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(30);
    expect(date.getSeconds()).toBe(0);
  });

  it('rejects invalid local dates and times', () => {
    expect(localDateTimePartsToIso({ date: '2026-02-30', time: '09:30' })).toBeNull();
    expect(localDateTimePartsToIso({ date: '2026-05-20', time: '24:00' })).toBeNull();
    expect(localDateTimePartsToIso({ date: '', time: '09:30' })).toBeNull();
  });
});

describe('buildCalendarDays', () => {
  it('builds a stable six-week calendar grid around the requested month', () => {
    const days = buildCalendarDays(new Date(2026, 4, 1));

    expect(days).toHaveLength(42);
    expect(days[0]).toMatchObject({ date: '2026-04-26', inCurrentMonth: false });
    expect(days.find((day) => day.date === '2026-05-20')).toMatchObject({
      day: 20,
      inCurrentMonth: true,
    });
  });
});
