import type { Language } from '../i18n';
import { getTimeZoneOffsetMinutes, isValidTimeZone } from './time-zone';

export interface DateTimeFormatOptions {
  timeZone?: string;
  language?: Language;
  fallback?: string;
}

export type MonitoringTimeGranularity = 'minute' | 'hour' | 'day';

const FORMAT_LOCALE = 'en-US-u-nu-latn';

function parseDate(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getZonedParts(date: Date, timeZone?: string) {
  const formatter = new Intl.DateTimeFormat(FORMAT_LOCALE, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '00';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export function formatDateTime(value: string | number | Date | null | undefined, options: DateTimeFormatOptions = {}) {
  const fallback = options.fallback ?? '-';
  const date = parseDate(value);
  if (!date) return fallback;
  try {
    const parts = getZonedParts(date, options.timeZone);
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  } catch {
    return fallback;
  }
}

export function formatDate(value: string | number | Date | null | undefined, options: DateTimeFormatOptions = {}) {
  const fallback = options.fallback ?? '-';
  const date = parseDate(value);
  if (!date) return fallback;
  try {
    const parts = getZonedParts(date, options.timeZone);
    return `${parts.year}/${parts.month}/${parts.day}`;
  } catch {
    return fallback;
  }
}

export function formatTime(
  value: string | number | Date | null | undefined,
  options: DateTimeFormatOptions & { seconds?: boolean } = {},
) {
  const fallback = options.fallback ?? '-';
  const date = parseDate(value);
  if (!date) return fallback;
  try {
    const parts = getZonedParts(date, options.timeZone);
    return options.seconds === false
      ? `${parts.hour}:${parts.minute}`
      : `${parts.hour}:${parts.minute}:${parts.second}`;
  } catch {
    return fallback;
  }
}

export function formatTimestampedDefaultName(
  prefix: string,
  value: string | number | Date | null | undefined = new Date(),
  options: Pick<DateTimeFormatOptions, 'timeZone'> = {},
) {
  const date = parseDate(value);
  if (!date) return `${prefix}-`;
  try {
    const parts = getZonedParts(date, options.timeZone);
    return `${prefix}-${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}-`;
  } catch {
    return `${prefix}-`;
  }
}

const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Both datetime-local helpers below fall back to UTC for a missing or invalid
 * zone so that {@link formatDateTimeLocalInput} and {@link parseDateTimeLocalInput}
 * stay exact inverses and never silently leak the browser's system zone. In
 * practice callers always pass `resolveDisplayTimeZone` output, which is already
 * a valid IANA zone.
 */
function resolveInputTimeZone(timeZone?: string): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';
}

/**
 * Render an instant as the `YYYY-MM-DDTHH:mm` wall-clock string that an
 * `<input type="datetime-local">` expects, interpreted in `timeZone` (the
 * resolved display time zone) rather than the browser's system time zone.
 * Returns '' for empty/invalid values so it can feed an input value directly.
 */
export function formatDateTimeLocalInput(value: string | number | Date | null | undefined, timeZone?: string): string {
  const date = parseDate(value);
  if (!date) return '';
  const parts = getZonedParts(date, resolveInputTimeZone(timeZone));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * Inverse of {@link formatDateTimeLocalInput}: read a zone-less
 * `YYYY-MM-DDTHH:mm[:ss]` value from a `datetime-local` input, interpret its
 * wall-clock components as being in `timeZone`, and return the corresponding
 * UTC ISO instant. Returns null for empty or malformed input. The two-pass
 * offset lookup keeps the result correct across daylight-saving boundaries.
 */
export function parseDateTimeLocalInput(value: string | null | undefined, timeZone?: string): string | null {
  if (!value) return null;
  const match = DATETIME_LOCAL_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);

  const wallAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(wallAsUtcMs);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute ||
    probe.getUTCSeconds() !== second
  ) {
    return null;
  }

  const zone = resolveInputTimeZone(timeZone);
  const offsetAt = (ms: number) => getTimeZoneOffsetMinutes(zone, new Date(ms));
  const firstGuessOffset = offsetAt(wallAsUtcMs);
  const resolvedOffset = offsetAt(wallAsUtcMs - firstGuessOffset * 60_000);
  return new Date(wallAsUtcMs - resolvedOffset * 60_000).toISOString();
}

export function formatMonitoringTick(
  value: string | number | Date | null | undefined,
  granularity: MonitoringTimeGranularity,
  options: DateTimeFormatOptions = {},
) {
  const fallback = options.fallback ?? '-';
  const date = parseDate(value);
  if (!date) return fallback;
  try {
    const parts = getZonedParts(date, options.timeZone);
    const month = String(Number(parts.month));
    const day = String(Number(parts.day));
    if (granularity === 'day') return `${month}/${day}`;
    if (granularity === 'hour') return `${month}/${day} ${parts.hour}:00`;
    return `${parts.hour}:${parts.minute}`;
  } catch {
    return fallback;
  }
}

export function formatLatencySeconds(latencyMs: number | null | undefined, fractionDigits = 2) {
  if (latencyMs === null || latencyMs === undefined || !Number.isFinite(latencyMs)) {
    return '-';
  }
  return (latencyMs / 1000).toFixed(fractionDigits);
}
