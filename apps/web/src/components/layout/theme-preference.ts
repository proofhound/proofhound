import { useCallback, useEffect, useState } from 'react';
import { isThemeName, type ThemeName } from './theme-options';

const THEME_STORAGE_KEY = 'proofhound.theme';
const THEME_CHANGE_EVENT = 'proofhound.theme-change';

function getSystemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(theme: ThemeName) {
  if (theme !== 'system') return theme;
  return getSystemPrefersDark() ? 'dark' : 'light';
}

function getStoredTheme(): ThemeName {
  if (typeof window === 'undefined') return 'system';
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeName(storedTheme) ? storedTheme : 'system';
}

function applyTheme(theme: ThemeName) {
  const resolvedTheme = resolveTheme(theme);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  document.documentElement.style.colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light';

  const themeColor = resolvedTheme === 'dark' ? '#020817' : '#ffffff';
  document.querySelector("meta[name='theme-color']")?.setAttribute('content', themeColor);
}

export function useThemePreference() {
  // Initial value uses SSR default 'system'; after mount, sync with the real localStorage value to avoid hydration mismatch
  const [theme, setTheme] = useState<ThemeName>('system');
  const [hasSyncedStoredTheme, setHasSyncedStoredTheme] = useState(false);

  useEffect(() => {
    const storedTheme = getStoredTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe localStorage sync, runs once on mount
    setTheme(storedTheme);
    applyTheme(storedTheme);
    setHasSyncedStoredTheme(true);
  }, []);

  useEffect(() => {
    if (!hasSyncedStoredTheme) return;

    applyTheme(theme);

    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => applyTheme('system');
    mediaQuery.addEventListener('change', handleSystemThemeChange);

    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, [hasSyncedStoredTheme, theme]);

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const nextTheme = (event as CustomEvent<ThemeName>).detail;
      if (isThemeName(nextTheme)) {
        setTheme(nextTheme);
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setTheme(isThemeName(event.newValue) ? event.newValue : 'system');
    };

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const setThemePreference = useCallback((nextTheme: ThemeName) => {
    setTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: nextTheme }));
  }, []);

  return { setThemePreference, theme };
}
