'use client';

import { Languages } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@proofhound/ui';
import { LANGUAGE_OPTIONS, isLanguage, useI18n } from '@proofhound/web-ui/i18n';
import { type LayoutPreferences } from './layout-preferences';
import { useThemePreference } from './theme-preference';
import { ThemeSettingsDrawer, ThemeSwatch } from './theme-settings-drawer';
import { isThemeName, THEME_OPTIONS } from './theme-options';

export function PreferenceControls({
  layoutPreferences,
  showThemeSwitch = true,
  showThemeSettings = true,
}: {
  layoutPreferences?: LayoutPreferences;
  showThemeSwitch?: boolean;
  showThemeSettings?: boolean;
}) {
  const { language, setLanguage, t } = useI18n();

  const handleLanguageChange = (value: string) => {
    if (!isLanguage(value)) return;
    setLanguage(value);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('preferences.changeLanguage')}>
                  <Languages aria-hidden="true" />
                  <span className="sr-only">{t('preferences.changeLanguage')}</span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('preferences.changeLanguage')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuLabel>{t('preferences.language')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={language} onValueChange={handleLanguageChange}>
              {LANGUAGE_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value} className="gap-2">
                  <span className="w-6 text-xs text-muted-foreground">{option.shortLabel}</span>
                  <span>{option.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {showThemeSwitch && <ThemeSwitchButton />}

        {showThemeSettings && <ThemeSettingsButton layoutPreferences={layoutPreferences} />}
      </div>
    </TooltipProvider>
  );
}

export function ThemeSwitchButton() {
  const { t } = useI18n();
  const { setThemePreference, theme } = useThemePreference();
  const activeTheme = THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[0];
  const ActiveIcon = activeTheme.icon;

  const handleThemeChange = (value: string) => {
    if (!isThemeName(value)) return;
    setThemePreference(value);
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('preferences.changeTheme')}>
              <ActiveIcon aria-hidden="true" />
              <span className="sr-only">{t('preferences.changeTheme')}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('preferences.changeTheme')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>{t('preferences.theme')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={theme} onValueChange={handleThemeChange}>
          {THEME_OPTIONS.map((option) => {
            const OptionIcon = option.icon;

            return (
              <DropdownMenuRadioItem key={option.value} value={option.value} className="gap-2">
                <OptionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t(option.labelKey)}</span>
                <ThemeSwatch color={option.sidebarColor} />
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeSettingsButton({ layoutPreferences }: { layoutPreferences?: LayoutPreferences }) {
  const { setThemePreference, theme } = useThemePreference();

  return (
    <TooltipProvider delayDuration={200}>
      <ThemeSettingsDrawer activeTheme={theme} layoutPreferences={layoutPreferences} onThemeChange={setThemePreference} />
    </TooltipProvider>
  );
}
