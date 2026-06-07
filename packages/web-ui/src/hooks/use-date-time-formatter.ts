'use client';

import { useMemo } from 'react';
import { useI18n } from '../i18n';
import {
  formatDate,
  formatDateTime,
  formatMonitoringTick,
  formatTime,
  type DateTimeFormatOptions,
  type MonitoringTimeGranularity,
} from '../lib/format';
import { useDisplayPreferences } from '../providers';

export function useDateTimeFormatter() {
  const { language } = useI18n();
  const { resolvedTimeZone } = useDisplayPreferences();

  return useMemo(() => {
    const withDefaults = (options: DateTimeFormatOptions = {}) => ({
      language,
      timeZone: resolvedTimeZone,
      ...options,
    });

    return {
      resolvedTimeZone,
      formatDateTime: (value: string | number | Date | null | undefined, options?: DateTimeFormatOptions) =>
        formatDateTime(value, withDefaults(options)),
      formatDate: (value: string | number | Date | null | undefined, options?: DateTimeFormatOptions) =>
        formatDate(value, withDefaults(options)),
      formatTime: (
        value: string | number | Date | null | undefined,
        options?: DateTimeFormatOptions & { seconds?: boolean },
      ) => formatTime(value, withDefaults(options)),
      formatMonitoringTick: (
        value: string | number | Date | null | undefined,
        granularity: MonitoringTimeGranularity,
        options?: DateTimeFormatOptions,
      ) => formatMonitoringTick(value, granularity, withDefaults(options)),
    };
  }, [language, resolvedTimeZone]);
}
