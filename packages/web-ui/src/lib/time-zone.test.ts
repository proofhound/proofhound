import { describe, expect, it } from 'vitest';

import {
  AUTO_TIME_ZONE_PREFERENCE,
  formatTimeZoneOffset,
  normalizeTimeZonePreference,
  resolveDisplayTimeZone,
  timeZoneMatchesSearch,
} from './time-zone';

describe('time zone preferences', () => {
  it('normalizes auto, valid IANA zones, and invalid values', () => {
    expect(normalizeTimeZonePreference(null)).toBe(AUTO_TIME_ZONE_PREFERENCE);
    expect(normalizeTimeZonePreference('auto')).toBe(AUTO_TIME_ZONE_PREFERENCE);
    expect(normalizeTimeZonePreference('Asia/Shanghai')).toBe('Asia/Shanghai');
    expect(normalizeTimeZonePreference('Mars/Olympus')).toBe(AUTO_TIME_ZONE_PREFERENCE);
  });

  it('resolves auto to the browser time zone', () => {
    expect(resolveDisplayTimeZone('auto', 'Asia/Shanghai')).toBe('Asia/Shanghai');
    expect(resolveDisplayTimeZone('auto', 'Mars/Olympus')).toBe('UTC');
    expect(resolveDisplayTimeZone('America/Los_Angeles', 'Asia/Shanghai')).toBe('America/Los_Angeles');
  });

  it('formats and searches IANA names, city names, and offsets', () => {
    const date = new Date('2026-01-15T12:00:00.000Z');
    expect(formatTimeZoneOffset('Asia/Shanghai', date)).toBe('UTC+08:00');
    expect(timeZoneMatchesSearch('Asia/Shanghai', 'Shanghai', date)).toBe(true);
    expect(timeZoneMatchesSearch('Asia/Shanghai', 'UTC+08', date)).toBe(true);
    expect(timeZoneMatchesSearch('America/Los_Angeles', 'Los Angeles', date)).toBe(true);
    expect(timeZoneMatchesSearch('America/Los_Angeles', 'Shanghai', date)).toBe(false);
  });
});
