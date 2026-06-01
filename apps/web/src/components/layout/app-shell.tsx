'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { SidebarInset, SidebarProvider, Button } from '@proofhound/ui';
import { AppSidebar, type SidebarCollapsible, type SidebarSide, type SidebarVariant } from './app-sidebar';
import { Header } from './header';
import { PreferenceControls, ThemeSettingsButton } from './preference-controls';
import {
  LAYOUT_COLLAPSIBLE_STORAGE_KEY,
  LAYOUT_VARIANT_STORAGE_KEY,
  SIDEBAR_SIDE_STORAGE_KEY,
  type LayoutMode,
  type LayoutPreferences,
} from './layout-preferences';
import { getMainNavGroups } from './sidebar-data';
import { useI18n, type TranslationKey } from '@proofhound/web-ui/i18n';
import { useProjectContext } from '@proofhound/web-ui/providers';
import type { ProjectContext } from '@proofhound/shared';
import { useCanaryReleaseList } from '@proofhound/web-ui/hooks';
import { useConnector } from '@proofhound/web-ui/hooks';
import { useDataset } from '@proofhound/web-ui/hooks';
import { useExperiment } from '@proofhound/web-ui/hooks';
import { useProjectModel } from '@proofhound/web-ui/hooks';
import { useOptimization } from '@proofhound/web-ui/hooks';
import { usePrompt } from '@proofhound/web-ui/hooks';
import { useReleaseLineList } from '@proofhound/web-ui/hooks';

interface AppShellProps {
  children: ReactNode;
}

const DEFAULT_SIDEBAR_VARIANT: SidebarVariant = 'sidebar';
const DEFAULT_SIDEBAR_COLLAPSIBLE: SidebarCollapsible = 'icon';
const DEFAULT_SIDEBAR_SIDE: SidebarSide = 'left';
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

type ProjectBreadcrumbContext = ProjectContext & {
  organizationName?: string | null;
  projectName?: string | null;
};

type BreadcrumbRoute = {
  moduleTitle: string;
  url: string;
};

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbEntityIds = {
  annotationTaskId: string;
  connectorId: string;
  datasetId: string;
  experimentId: string;
  modelId: string;
  optimizationId: string;
  promptId: string;
  releaseLineId: string;
};

function getCookieValue(name: string) {
  if (typeof document === 'undefined') return null;
  return (
    document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.split('=')[1] ?? null
  );
}

function getStoredSidebarOpen() {
  return getCookieValue('sidebar_state') !== 'false';
}

function isSidebarVariant(value: string | null): value is SidebarVariant {
  return value === 'sidebar' || value === 'floating' || value === 'inset';
}

function isSidebarCollapsible(value: string | null): value is SidebarCollapsible {
  return value === 'offcanvas' || value === 'icon' || value === 'none';
}

function isSidebarSide(value: string | null): value is SidebarSide {
  return value === 'left' || value === 'right';
}

function getStoredSidebarVariant(): SidebarVariant {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_VARIANT;
  const storedValue = window.localStorage.getItem(LAYOUT_VARIANT_STORAGE_KEY);
  return isSidebarVariant(storedValue) ? storedValue : DEFAULT_SIDEBAR_VARIANT;
}

function getStoredSidebarCollapsible(): SidebarCollapsible {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_COLLAPSIBLE;
  const storedValue = window.localStorage.getItem(LAYOUT_COLLAPSIBLE_STORAGE_KEY);
  return isSidebarCollapsible(storedValue) ? storedValue : DEFAULT_SIDEBAR_COLLAPSIBLE;
}

function getStoredSidebarSide(): SidebarSide {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_SIDE;
  const storedValue = window.localStorage.getItem(SIDEBAR_SIDE_STORAGE_KEY);
  return isSidebarSide(storedValue) ? storedValue : DEFAULT_SIDEBAR_SIDE;
}

function getLayoutMode(open: boolean, collapsible: SidebarCollapsible): LayoutMode {
  if (open) return 'default';
  return collapsible === 'offcanvas' ? 'full' : 'compact';
}

function normalizePathname(pathname: string) {
  if (pathname === '/') return '/dashboard';
  return pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
}

function getBreadcrumbRoutes(t: (key: TranslationKey) => string): BreadcrumbRoute[] {
  const groupedRoutes: BreadcrumbRoute[] = getMainNavGroups(t).flatMap((group) =>
    group.items.flatMap((item) =>
      item.url
        ? [
            {
              moduleTitle: item.title,
              url: item.url,
            },
          ]
        : [],
    ),
  );
  const legacyRoutes: BreadcrumbRoute[] = [
    {
      moduleTitle: t('nav.quickStart'),
      url: '/quick-start',
    },
    {
      moduleTitle: t('nav.comparisons'),
      url: '/comparisons',
    },
  ];

  return [...groupedRoutes, ...legacyRoutes].sort((left, right) => right.url.length - left.url.length);
}

function getBreadcrumbActionTitle(
  pathname: string,
  route: BreadcrumbRoute,
  t: (key: TranslationKey) => string,
  entityTitle?: string,
) {
  const remainder = pathname.slice(route.url.length).split('/').filter(Boolean);

  if (remainder.length === 0) return null;
  if (remainder[0] === 'new') return t(route.url === '/datasets' ? 'nav.breadcrumb.upload' : 'nav.breadcrumb.create');
  if (entityTitle) return entityTitle;
  if (remainder.includes('edit')) return t('nav.breadcrumb.edit');
  if (remainder.includes('annotations')) return t('nav.breadcrumb.annotationWorkspace');

  return t('nav.breadcrumb.detail');
}

function getPageBreadcrumbItems(pathname: string, t: (key: TranslationKey) => string, entityTitle?: string) {
  const normalizedPathname = normalizePathname(pathname);
  const route = getBreadcrumbRoutes(t).find(
    (item) => normalizedPathname === item.url || normalizedPathname.startsWith(`${item.url}/`),
  );

  if (!route) return [{ label: 'ProofHound' }];

  const actionTitle = getBreadcrumbActionTitle(normalizedPathname, route, t, entityTitle);
  return [
    { label: route.moduleTitle, href: route.url },
    actionTitle ? { label: actionTitle } : null,
  ].filter(isBreadcrumbItem);
}

function isBreadcrumbSegment(segment: string | null | undefined): segment is string {
  return Boolean(segment?.trim());
}

function isBreadcrumbItem(item: BreadcrumbItem | null | undefined): item is BreadcrumbItem {
  return isBreadcrumbSegment(item?.label);
}

function getRouteDetailId(pathname: string, basePath: string) {
  const normalizedPathname = normalizePathname(pathname);
  if (!normalizedPathname.startsWith(`${basePath}/`)) return '';

  const [detailId] = normalizedPathname.slice(basePath.length).split('/').filter(Boolean);
  if (!detailId || detailId === 'new') return '';

  return decodeURIComponent(detailId);
}

function getBreadcrumbEntityIds(pathname: string): BreadcrumbEntityIds {
  return {
    annotationTaskId: getRouteDetailId(pathname, '/annotations'),
    connectorId: getRouteDetailId(pathname, '/connectors'),
    datasetId: getRouteDetailId(pathname, '/datasets'),
    experimentId: getRouteDetailId(pathname, '/experiments'),
    modelId: getRouteDetailId(pathname, '/models'),
    optimizationId: getRouteDetailId(pathname, '/optimizations'),
    promptId: getRouteDetailId(pathname, '/prompts'),
    releaseLineId: getRouteDetailId(pathname, '/releases'),
  };
}

function getProjectBreadcrumbItems(projectContext: ProjectBreadcrumbContext, t: (key: TranslationKey) => string) {
  const items: BreadcrumbItem[] = [];

  if (isBreadcrumbSegment(projectContext.organizationName)) {
    items.push({ label: projectContext.organizationName });
  }

  items.push({ label: projectContext.projectName ?? t('nav.defaultProject'), href: '/dashboard' });
  return items;
}

function useBreadcrumbEntityTitle(pathname: string, projectId: string) {
  const entityIds = useMemo(() => getBreadcrumbEntityIds(pathname), [pathname]);
  const annotationQuery = useCanaryReleaseList(projectId, Boolean(entityIds.annotationTaskId));
  const connectorQuery = useConnector(projectId, entityIds.connectorId);
  const datasetQuery = useDataset(projectId, entityIds.datasetId);
  const experimentQuery = useExperiment(projectId, entityIds.experimentId);
  const modelQuery = useProjectModel(projectId, entityIds.modelId);
  const optimizationQuery = useOptimization(projectId, entityIds.optimizationId);
  const promptQuery = usePrompt(projectId, entityIds.promptId);
  const releaseLineQuery = useReleaseLineList(projectId, Boolean(entityIds.releaseLineId));

  const annotationTitle = useMemo(
    () => {
      const canary = annotationQuery.data?.data.find(
        (item) => (item.annotationTaskId ?? item.id) === entityIds.annotationTaskId,
      );
      return canary ? (canary.name ?? canary.promptVersionLabel ?? canary.id.slice(0, 8)) : undefined;
    },
    [annotationQuery.data, entityIds.annotationTaskId],
  );

  const releaseLineTitle = useMemo(
    () => releaseLineQuery.data.find((line) => line.id === entityIds.releaseLineId)?.label,
    [entityIds.releaseLineId, releaseLineQuery.data],
  );

  if (entityIds.annotationTaskId) return annotationTitle;
  if (entityIds.connectorId) return connectorQuery.data?.name;
  if (entityIds.datasetId) return datasetQuery.data?.name;
  if (entityIds.experimentId) return experimentQuery.data?.name;
  if (entityIds.modelId) return modelQuery.data?.name;
  if (entityIds.optimizationId) return optimizationQuery.data?.name;
  if (entityIds.promptId) return promptQuery.data?.name;
  if (entityIds.releaseLineId) return releaseLineTitle;

  return undefined;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const projectContext = useProjectContext();
  const entityTitle = useBreadcrumbEntityTitle(pathname, projectContext.projectId);
  // Initial value uses SSR default; after mount, sync with the real cookie / localStorage to avoid hydration mismatch
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarVariant, setSidebarVariantState] = useState<SidebarVariant>(DEFAULT_SIDEBAR_VARIANT);
  const [sidebarCollapsible, setSidebarCollapsibleState] = useState<SidebarCollapsible>(DEFAULT_SIDEBAR_COLLAPSIBLE);
  const [sidebarSide, setSidebarSideState] = useState<SidebarSide>(DEFAULT_SIDEBAR_SIDE);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe cookie / localStorage sync, runs once on mount
    setSidebarOpen(getStoredSidebarOpen());
    setSidebarVariantState(getStoredSidebarVariant());
    setSidebarCollapsibleState(getStoredSidebarCollapsible());
    setSidebarSideState(getStoredSidebarSide());
  }, []);
  const setSidebarOpenPreference = useCallback((nextOpen: boolean) => {
    setSidebarOpen(nextOpen);
    document.cookie = `sidebar_state=${nextOpen}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
  }, []);

  const setSidebarVariant = useCallback((nextVariant: SidebarVariant) => {
    setSidebarVariantState(nextVariant);
    window.localStorage.setItem(LAYOUT_VARIANT_STORAGE_KEY, nextVariant);
  }, []);

  const setSidebarCollapsible = useCallback((nextCollapsible: SidebarCollapsible) => {
    setSidebarCollapsibleState(nextCollapsible);
    window.localStorage.setItem(LAYOUT_COLLAPSIBLE_STORAGE_KEY, nextCollapsible);
  }, []);

  const setSidebarSide = useCallback((nextSide: SidebarSide) => {
    setSidebarSideState(nextSide);
    window.localStorage.setItem(SIDEBAR_SIDE_STORAGE_KEY, nextSide);
  }, []);

  const setLayoutMode = useCallback(
    (nextLayoutMode: LayoutMode) => {
      if (nextLayoutMode === 'default') {
        setSidebarOpenPreference(true);
        setSidebarCollapsible(DEFAULT_SIDEBAR_COLLAPSIBLE);
        return;
      }

      setSidebarOpenPreference(false);
      setSidebarCollapsible(nextLayoutMode === 'full' ? 'offcanvas' : 'icon');
    },
    [setSidebarCollapsible, setSidebarOpenPreference],
  );

  const resetLayoutPreferences = useCallback(() => {
    setSidebarOpenPreference(true);
    setSidebarVariant(DEFAULT_SIDEBAR_VARIANT);
    setSidebarCollapsible(DEFAULT_SIDEBAR_COLLAPSIBLE);
    setSidebarSide(DEFAULT_SIDEBAR_SIDE);
  }, [setSidebarCollapsible, setSidebarOpenPreference, setSidebarSide, setSidebarVariant]);

  const layoutPreferences = useMemo<LayoutPreferences>(
    () => ({
      defaultLayoutMode: 'default',
      defaultSidebarSide: DEFAULT_SIDEBAR_SIDE,
      defaultSidebarVariant: DEFAULT_SIDEBAR_VARIANT,
      layoutMode: getLayoutMode(sidebarOpen, sidebarCollapsible),
      setLayoutMode,
      resetLayoutPreferences,
      setSidebarSide,
      setSidebarVariant,
      sidebarSide,
      sidebarVariant,
    }),
    [
      resetLayoutPreferences,
      setLayoutMode,
      setSidebarSide,
      setSidebarVariant,
      sidebarCollapsible,
      sidebarOpen,
      sidebarSide,
      sidebarVariant,
    ],
  );

  const breadcrumbItems = useMemo(
    () => [...getProjectBreadcrumbItems(projectContext, t), ...getPageBreadcrumbItems(pathname, t, entityTitle)],
    [entityTitle, pathname, projectContext, t],
  );

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpenPreference}>
      <AppSidebar
        collapsible={sidebarCollapsible}
        side={sidebarSide}
        variant={sidebarVariant}
      />
      <SidebarInset>
        <Header fixed sidebarSide={sidebarSide}>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <nav aria-label={t('nav.breadcrumbLabel')} className="min-w-0 flex-1">
              <ol className="flex min-w-0 items-center gap-1 text-sm">
                {breadcrumbItems.map((item, index) => {
                  const isLast = index === breadcrumbItems.length - 1;

                  return (
                    <Fragment key={`${item.label}-${index}`}>
                      {index > 0 ? (
                        <li aria-hidden="true" className="shrink-0 text-muted-foreground/60">
                          /
                        </li>
                      ) : null}
                      <li
                        className={
                          isLast
                            ? 'min-w-0 flex-1 truncate font-medium text-foreground'
                            : 'min-w-0 max-w-[36vw] shrink truncate text-muted-foreground sm:max-w-72'
                        }
                        aria-current={isLast ? 'page' : undefined}
                      >
                        {isLast ? (
                          <h1 className="truncate">{item.label}</h1>
                        ) : item.href ? (
                          <Link
                            href={item.href}
                            className="block truncate rounded-sm transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {item.label}
                          </Link>
                        ) : (
                          item.label
                        )}
                      </li>
                    </Fragment>
                  );
                })}
              </ol>
            </nav>
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild size="sm" className="h-8 px-2.5" aria-label={t('quickStart.title')}>
                <Link href="/quick-start">
                  <Sparkles className="size-4" />
                  <span className="hidden sm:inline">{t('quickStart.title')}</span>
                </Link>
              </Button>
              <PreferenceControls showThemeSettings={false} />
              <ThemeSettingsButton layoutPreferences={layoutPreferences} />
            </div>
          </div>
        </Header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
