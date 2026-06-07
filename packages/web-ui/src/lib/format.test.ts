import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatMonitoringTick, formatTime } from './format';

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
