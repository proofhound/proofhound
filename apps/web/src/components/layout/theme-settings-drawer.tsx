import {
  CheckCircle2,
  Maximize2,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  RotateCcw,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@proofhound/ui';
import { useI18n, type TranslationKey } from '@proofhound/web-ui/i18n';
import type { LayoutMode, LayoutPreferences } from './layout-preferences';
import { THEME_OPTIONS, type ThemeName, type ThemeOption } from './theme-options';

export function ThemeSwatch({ color }: { color: string }) {
  return (
    <span
      className="h-3.5 w-3.5 shrink-0 rounded-full border"
      style={{ background: color }}
      aria-hidden="true"
      data-testid="theme-palette-preview"
    />
  );
}

function SectionTitle({
  title,
  showReset,
  onReset,
  resetAriaLabel,
}: {
  title: string;
  showReset?: boolean;
  onReset?: () => void;
  resetAriaLabel?: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
      {title}
      {showReset && onReset && (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-5 w-5 rounded-full"
          onClick={onReset}
          aria-label={resetAriaLabel}
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function ThemePreview({ option }: { option: ThemeOption }) {
  return (
    <div className="h-20 rounded-md border p-1.5" style={{ background: option.preview.background }} aria-hidden="true">
      <div className="flex h-full gap-1.5">
        <div className="w-7 rounded-sm" style={{ background: option.preview.sidebar }} />
        <div className="flex flex-1 flex-col gap-1.5 rounded-sm p-1.5 shadow-sm" style={{ background: option.preview.panel }}>
          <div className="h-2 w-12 rounded-full" style={{ background: option.preview.primary }} />
          <div className="h-2 w-16 rounded-full" style={{ background: option.preview.muted }} />
          <div className="mt-auto flex items-center gap-1">
            <span className="h-3 w-3 rounded-full" style={{ background: option.preview.muted }} />
            <span className="h-2 w-12 rounded-full" style={{ background: option.preview.muted }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionButton({
  active,
  icon: Icon,
  label,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'group relative min-w-0 rounded-md border bg-background p-2 text-left outline-none transition',
        'hover:border-primary/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active && 'border-primary shadow-sm',
      )}
    >
      {active && (
        <CheckCircle2
          className="absolute right-1.5 top-1.5 z-10 h-5 w-5 fill-primary text-primary-foreground"
          aria-hidden="true"
        />
      )}
      {children ?? (
        <div className="flex h-20 items-center justify-center rounded-md bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground group-aria-checked:text-primary" />
        </div>
      )}
      <span className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
    </button>
  );
}

export function ThemeSettingsDrawer({
  activeTheme,
  layoutPreferences,
  onThemeChange,
}: {
  activeTheme: ThemeName;
  layoutPreferences?: LayoutPreferences;
  onThemeChange: (theme: ThemeName) => void;
}) {
  const { t } = useI18n();

  const handleResetAll = () => {
    onThemeChange('system');
    layoutPreferences?.resetLayoutPreferences();
  };

  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label={t('preferences.openThemeSettings')}>
              <Settings aria-hidden="true" />
              <span
                className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border border-background"
                style={{
                  background:
                    THEME_OPTIONS.find((option) => option.value === activeTheme)?.sidebarColor ??
                    THEME_OPTIONS[0].sidebarColor,
                }}
                aria-hidden="true"
              />
              <span className="sr-only">{t('preferences.openThemeSettings')}</span>
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('preferences.openThemeSettings')}</TooltipContent>
      </Tooltip>
      <SheetContent className="flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pb-4 pt-6 text-left">
          <SheetTitle>{t('preferences.themeSettings')}</SheetTitle>
          <SheetDescription>{t('preferences.themeSettingsDescription')}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-4">
          <section>
            <SectionTitle
              title={t('preferences.theme')}
              showReset={activeTheme !== 'system'}
              onReset={() => onThemeChange('system')}
              resetAriaLabel={t('preferences.resetTheme')}
            />
            <div role="radiogroup" aria-label={t('preferences.theme')} className="grid grid-cols-2 gap-3">
              {THEME_OPTIONS.map((option) => (
                <OptionButton
                  key={option.value}
                  active={activeTheme === option.value}
                  icon={option.icon}
                  label={t(option.labelKey)}
                  onClick={() => onThemeChange(option.value)}
                  testId="theme-option-card"
                >
                  <ThemePreview option={option} />
                  <ThemeSwatch color={option.sidebarColor} />
                </OptionButton>
              ))}
            </div>
          </section>

          {layoutPreferences && (
            <>
              <section className="max-md:hidden">
                <SectionTitle
                  title={t('preferences.sidebar')}
                  showReset={layoutPreferences.sidebarVariant !== layoutPreferences.defaultSidebarVariant}
                  onReset={() => layoutPreferences.setSidebarVariant(layoutPreferences.defaultSidebarVariant)}
                  resetAriaLabel={t('preferences.resetSidebar')}
                />
                <div role="radiogroup" aria-label={t('preferences.sidebar')} className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'sidebar', labelKey: 'preferences.sidebarStandard', icon: PanelLeft },
                    { value: 'floating', labelKey: 'preferences.sidebarFloating', icon: PanelLeftClose },
                    { value: 'inset', labelKey: 'preferences.sidebarInset', icon: PanelLeft },
                  ].map((option) => (
                    <OptionButton
                      key={option.value}
                      active={layoutPreferences.sidebarVariant === option.value}
                      icon={option.icon}
                      label={t(option.labelKey as TranslationKey)}
                      onClick={() => layoutPreferences.setSidebarVariant(option.value as LayoutPreferences['sidebarVariant'])}
                    />
                  ))}
                </div>
              </section>

              <section className="max-md:hidden">
                <SectionTitle
                  title={t('preferences.sidebarPosition')}
                  showReset={layoutPreferences.sidebarSide !== layoutPreferences.defaultSidebarSide}
                  onReset={() => layoutPreferences.setSidebarSide(layoutPreferences.defaultSidebarSide)}
                  resetAriaLabel={t('preferences.resetSidebarPosition')}
                />
                <div role="radiogroup" aria-label={t('preferences.sidebarPosition')} className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'left', labelKey: 'preferences.sidebarLeft', icon: PanelLeft },
                    { value: 'right', labelKey: 'preferences.sidebarRight', icon: PanelRight },
                  ].map((option) => (
                    <OptionButton
                      key={option.value}
                      active={layoutPreferences.sidebarSide === option.value}
                      icon={option.icon}
                      label={t(option.labelKey as TranslationKey)}
                      onClick={() => layoutPreferences.setSidebarSide(option.value as LayoutPreferences['sidebarSide'])}
                    />
                  ))}
                </div>
              </section>

              <section className="max-md:hidden">
                <SectionTitle
                  title={t('preferences.layout')}
                  showReset={layoutPreferences.layoutMode !== layoutPreferences.defaultLayoutMode}
                  onReset={() => layoutPreferences.setLayoutMode(layoutPreferences.defaultLayoutMode)}
                  resetAriaLabel={t('preferences.resetLayout')}
                />
                <div role="radiogroup" aria-label={t('preferences.layout')} className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'default', labelKey: 'preferences.layoutDefault', icon: PanelLeft },
                    { value: 'compact', labelKey: 'preferences.layoutCompact', icon: PanelLeftClose },
                    { value: 'full', labelKey: 'preferences.layoutFull', icon: Maximize2 },
                  ].map((option) => (
                    <OptionButton
                      key={option.value}
                      active={layoutPreferences.layoutMode === option.value}
                      icon={option.icon}
                      label={t(option.labelKey as TranslationKey)}
                      onClick={() => layoutPreferences.setLayoutMode(option.value as LayoutMode)}
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
        <SheetFooter className="border-t px-6 py-4">
          <Button type="button" variant="outline" className="w-full" onClick={handleResetAll}>
            <RotateCcw aria-hidden="true" />
            {t('preferences.resetAll')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
