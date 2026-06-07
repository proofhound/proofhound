export const TIME_ZONE_STORAGE_KEY = 'proofhound.timeZone';
export const AUTO_TIME_ZONE_PREFERENCE = 'auto';

export type TimeZonePreference = typeof AUTO_TIME_ZONE_PREFERENCE | (string & {});

const FALLBACK_TIME_ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
] as const;

function getIntlWithSupportedValues() {
  return Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
}

export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZonePreference(value: string | null | undefined): TimeZonePreference {
  if (!value || value === AUTO_TIME_ZONE_PREFERENCE) return AUTO_TIME_ZONE_PREFERENCE;
  return isValidTimeZone(value) ? value : AUTO_TIME_ZONE_PREFERENCE;
}

export function resolveDisplayTimeZone(
  preference: string | null | undefined,
  browserTimeZone = getBrowserTimeZone(),
) {
  const normalized = normalizeTimeZonePreference(preference);
  if (normalized === AUTO_TIME_ZONE_PREFERENCE) {
    return isValidTimeZone(browserTimeZone) ? browserTimeZone : 'UTC';
  }
  return normalized;
}

export function getSupportedTimeZones() {
  const supportedValuesOf = getIntlWithSupportedValues().supportedValuesOf;
  const zones = supportedValuesOf ? supportedValuesOf('timeZone') : [...FALLBACK_TIME_ZONES];
  const unique = new Set([...zones, ...FALLBACK_TIME_ZONES].filter(isValidTimeZone));
  return [...unique].sort((left, right) => left.localeCompare(right));
}

function getZonedDateParts(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat('en-US-u-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export function getTimeZoneOffsetMinutes(timeZone: string, date = new Date()) {
  if (!isValidTimeZone(timeZone)) return 0;
  const parts = getZonedDateParts(timeZone, date);
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((zonedAsUtc - date.getTime()) / 60_000);
}

export function formatTimeZoneOffset(timeZone: string, date = new Date()) {
  const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, date);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

export function getTimeZoneCityLabel(timeZone: string) {
  const city = timeZone.split('/').at(-1) ?? timeZone;
  return city.replace(/_/g, ' ');
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getTimeZoneSearchText(timeZone: string, date = new Date()) {
  const offset = formatTimeZoneOffset(timeZone, date);
  return normalizeSearchText(
    [
      timeZone,
      timeZone.replace(/\//g, ' '),
      getTimeZoneCityLabel(timeZone),
      offset,
      offset.replace(':00', ''),
      offset.replace(':', ''),
    ].join(' '),
  );
}

export function timeZoneMatchesSearch(timeZone: string, search: string, date = new Date()) {
  const query = normalizeSearchText(search);
  return query.length === 0 || getTimeZoneSearchText(timeZone, date).includes(query);
}
