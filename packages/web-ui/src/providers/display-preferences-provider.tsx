'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import {
  AUTO_TIME_ZONE_PREFERENCE,
  getBrowserTimeZone,
  normalizeTimeZonePreference,
  resolveDisplayTimeZone,
  TIME_ZONE_STORAGE_KEY,
  type TimeZonePreference,
} from '../lib/time-zone';

export interface DisplayPreferencesContract {
  timeZonePreference: string;
  resolvedTimeZone: string;
  setTimeZonePreference?: (value: string) => void;
}

export interface DisplayPreferencesContextValue {
  timeZonePreference: TimeZonePreference;
  resolvedTimeZone: string;
  setTimeZonePreference: (value: TimeZonePreference) => void;
}

const DisplayPreferencesContext = createContext<DisplayPreferencesContextValue | null>(null);

function getStoredTimeZonePreference(): TimeZonePreference {
  if (typeof window === 'undefined') return AUTO_TIME_ZONE_PREFERENCE;
  try {
    return normalizeTimeZonePreference(window.localStorage.getItem(TIME_ZONE_STORAGE_KEY));
  } catch {
    return AUTO_TIME_ZONE_PREFERENCE;
  }
}

export function DisplayPreferencesProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: DisplayPreferencesContract;
}) {
  const [localPreference, setLocalPreference] = useState<TimeZonePreference>(() => getStoredTimeZonePreference());
  const [browserTimeZone] = useState(() => getBrowserTimeZone());

  const timeZonePreference = normalizeTimeZonePreference(value?.timeZonePreference ?? localPreference);
  const resolvedTimeZone = resolveDisplayTimeZone(value?.resolvedTimeZone ?? timeZonePreference, browserTimeZone);

  const setTimeZonePreference = useCallback(
    (nextPreference: TimeZonePreference) => {
      const normalized = normalizeTimeZonePreference(nextPreference);
      if (value?.setTimeZonePreference) {
        value.setTimeZonePreference(normalized);
        return;
      }
      setLocalPreference(normalized);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, normalized);
      }
    },
    [value],
  );

  const contextValue = useMemo(
    () => ({
      timeZonePreference,
      resolvedTimeZone,
      setTimeZonePreference,
    }),
    [resolvedTimeZone, setTimeZonePreference, timeZonePreference],
  );

  return <DisplayPreferencesContext.Provider value={contextValue}>{children}</DisplayPreferencesContext.Provider>;
}

export function useDisplayPreferences() {
  const context = useContext(DisplayPreferencesContext);
  if (!context) {
    throw new Error('useDisplayPreferences must be used within DisplayPreferencesProvider');
  }
  return context;
}
