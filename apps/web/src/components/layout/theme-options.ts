import { Monitor, Moon, Palette, Sun, type LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@proofhound/web-ui/i18n';

export type ThemeName = 'system' | 'light' | 'dark' | 'twilight' | 'electric';

export type ThemeOption = {
  value: ThemeName;
  labelKey: TranslationKey;
  icon: LucideIcon;
  preview: {
    background: string;
    panel: string;
    sidebar: string;
    primary: string;
    muted: string;
  };
  sidebarColor: string;
};

export const THEME_OPTIONS = [
  {
    value: 'system',
    labelKey: 'preferences.themeSystem',
    icon: Monitor,
    sidebarColor: 'linear-gradient(90deg, oklch(1 0 0) 0 50%, oklch(0.129 0.042 264.695) 50% 100%)',
    preview: {
      background: 'linear-gradient(90deg, #f8fafc 0 50%, #111827 50% 100%)',
      panel: '#ffffff',
      sidebar: 'linear-gradient(90deg, #ffffff 0 50%, #1f2937 50% 100%)',
      primary: '#1f2937',
      muted: '#e5e7eb',
    },
  },
  {
    value: 'light',
    labelKey: 'preferences.themeLight',
    icon: Sun,
    sidebarColor: 'oklch(1 0 0)',
    preview: {
      background: '#f8fafc',
      panel: '#ffffff',
      sidebar: '#ffffff',
      primary: '#1f2937',
      muted: '#e5e7eb',
    },
  },
  {
    value: 'dark',
    labelKey: 'preferences.themeDark',
    icon: Moon,
    sidebarColor: 'oklch(0.129 0.042 264.695)',
    preview: {
      background: '#111827',
      panel: '#1f2937',
      sidebar: '#111827',
      primary: '#e5e7eb',
      muted: '#4b5563',
    },
  },
  {
    value: 'twilight',
    labelKey: 'preferences.themeTwilight',
    icon: Palette,
    sidebarColor: 'hsl(18 41% 95%)',
    preview: {
      background: '#f8f5f3',
      panel: '#ffffff',
      sidebar: '#f5ebe6',
      primary: '#282c3e',
      muted: '#eadbd2',
    },
  },
  {
    value: 'electric',
    labelKey: 'preferences.themeElectric',
    icon: Palette,
    sidebarColor: 'hsl(213 41% 95%)',
    preview: {
      background: '#f4f8fd',
      panel: '#ffffff',
      sidebar: '#e7f0fb',
      primary: '#1d1f49',
      muted: '#dae5f1',
    },
  },
] as const satisfies readonly ThemeOption[];

export function isThemeName(value: string | null): value is ThemeName {
  return THEME_OPTIONS.some((option) => option.value === value);
}
