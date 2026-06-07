import type { Language } from '../i18n';

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

export function formatDateTime(
  value: string | number | Date | null | undefined,
  options: DateTimeFormatOptions = {},
) {
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

export function formatDate(
  value: string | number | Date | null | undefined,
  options: DateTimeFormatOptions = {},
) {
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
