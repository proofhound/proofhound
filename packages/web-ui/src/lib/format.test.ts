import { describe, expect, it } from 'vitest';

import {
  formatDate,
  formatDateTime,
  formatDateTimeLocalInput,
  formatMonitoringTick,
  formatTimestampedDefaultName,
  formatTime,
  parseDateTimeLocalInput,
} from './format';

describe('date time formatting', () => {
  const value = '2026-01-15T12:34:56.000Z';

  it('formats the same timestamp in the requested time zone', () => {
    expect(formatDateTime(value, { timeZone: 'UTC' })).toBe('2026/01/15 12:34:56');
    expect(formatDateTime(value, { timeZone: 'Asia/Shanghai' })).toBe('2026/01/15 20:34:56');
    expect(formatDateTime(value, { timeZone: 'America/Los_Angeles' })).toBe('2026/01/15 04:34:56');
  });

  it('formats date, time, and monitoring ticks with the same zone rules', () => {
    expect(formatDate(value, { timeZone: 'Asia/Shanghai' })).toBe('2026/01/15');
    expect(formatTime(value, { timeZone: 'Asia/Shanghai' })).toBe('20:34:56');
    expect(formatTime(value, { timeZone: 'Asia/Shanghai', seconds: false })).toBe('20:34');
    expect(formatMonitoringTick(value, 'minute', { timeZone: 'Asia/Shanghai' })).toBe('20:34');
    expect(formatMonitoringTick(value, 'hour', { timeZone: 'Asia/Shanghai' })).toBe('1/15 20:00');
    expect(formatMonitoringTick(value, 'day', { timeZone: 'Asia/Shanghai' })).toBe('1/15');
  });

  it('uses the requested fallback for empty or invalid values', () => {
    expect(formatDateTime(null)).toBe('-');
    expect(formatDateTime('not-a-date', { fallback: '—' })).toBe('—');
    expect(formatDateTime(value, { timeZone: 'Mars/Olympus', fallback: '—' })).toBe('—');
  });
});

describe('timestamped default names', () => {
  const instant = '2026-06-27T01:11:30.000Z';

  it('builds prefix-YYYYMMDDHHmm- using the requested time zone', () => {
    expect(formatTimestampedDefaultName('exp', instant, { timeZone: 'Asia/Shanghai' })).toBe('exp-202606270911-');
    expect(formatTimestampedDefaultName('optm', instant, { timeZone: 'UTC' })).toBe('optm-202606270111-');
  });

  it('keeps the trailing dash even when the date is invalid', () => {
    expect(formatTimestampedDefaultName('release', 'not-a-date')).toBe('release-');
  });

  it('falls back instead of throwing when the time zone is invalid', () => {
    expect(formatTimestampedDefaultName('anno', instant, { timeZone: 'Mars/Olympus' })).toBe('anno-');
  });
});

describe('datetime-local input helpers', () => {
  const iso = '2026-01-15T12:34:56.000Z';

  it('formats an ISO instant into a zoned datetime-local value (minute precision)', () => {
    expect(formatDateTimeLocalInput(iso, 'UTC')).toBe('2026-01-15T12:34');
    expect(formatDateTimeLocalInput(iso, 'Asia/Shanghai')).toBe('2026-01-15T20:34');
    expect(formatDateTimeLocalInput(iso, 'America/Los_Angeles')).toBe('2026-01-15T04:34');
  });

  it('returns an empty string for missing or invalid values when formatting', () => {
    expect(formatDateTimeLocalInput(null, 'UTC')).toBe('');
    expect(formatDateTimeLocalInput(undefined, 'UTC')).toBe('');
    expect(formatDateTimeLocalInput('', 'UTC')).toBe('');
    expect(formatDateTimeLocalInput('not-a-date', 'UTC')).toBe('');
  });

  it('falls back to UTC for a missing or invalid zone so format and parse stay inverses', () => {
    expect(formatDateTimeLocalInput(iso, 'Mars/Olympus')).toBe('2026-01-15T12:34');
    expect(formatDateTimeLocalInput(iso, undefined)).toBe('2026-01-15T12:34');
    expect(parseDateTimeLocalInput('2026-01-15T12:34', 'Mars/Olympus')).toBe('2026-01-15T12:34:00.000Z');
    expect(parseDateTimeLocalInput('2026-01-15T12:34', undefined)).toBe('2026-01-15T12:34:00.000Z');
  });

  it('parses a zoned datetime-local value back into a UTC ISO instant', () => {
    expect(parseDateTimeLocalInput('2026-01-15T12:34', 'UTC')).toBe('2026-01-15T12:34:00.000Z');
    expect(parseDateTimeLocalInput('2026-01-15T20:34', 'Asia/Shanghai')).toBe('2026-01-15T12:34:00.000Z');
    expect(parseDateTimeLocalInput('2026-01-15T04:34', 'America/Los_Angeles')).toBe('2026-01-15T12:34:00.000Z');
  });

  it('honours daylight saving offsets when parsing', () => {
    // America/Los_Angeles is UTC-8 (PST) in January, UTC-7 (PDT) in July.
    expect(parseDateTimeLocalInput('2026-01-15T04:00', 'America/Los_Angeles')).toBe('2026-01-15T12:00:00.000Z');
    expect(parseDateTimeLocalInput('2026-07-15T05:00', 'America/Los_Angeles')).toBe('2026-07-15T12:00:00.000Z');
  });

  it('accepts an optional seconds segment in the input', () => {
    expect(parseDateTimeLocalInput('2026-01-15T20:34:56', 'Asia/Shanghai')).toBe('2026-01-15T12:34:56.000Z');
  });

  it('round-trips an instant through format then parse in the same zone', () => {
    const instant = '2026-06-15T12:34:00.000Z';
    for (const timeZone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Australia/Sydney']) {
      const local = formatDateTimeLocalInput(instant, timeZone);
      expect(parseDateTimeLocalInput(local, timeZone)).toBe(instant);
    }
  });

  it('returns null for missing or malformed values when parsing', () => {
    expect(parseDateTimeLocalInput(null, 'UTC')).toBeNull();
    expect(parseDateTimeLocalInput('', 'UTC')).toBeNull();
    expect(parseDateTimeLocalInput('garbage', 'UTC')).toBeNull();
    expect(parseDateTimeLocalInput('2026-13-40T12:34', 'UTC')).toBeNull();
    expect(parseDateTimeLocalInput('2026-01-15T25:00', 'UTC')).toBeNull();
  });
});
