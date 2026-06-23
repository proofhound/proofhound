'use client';

import { type ReactNode, useState } from 'react';
import { configureApiClient } from '@proofhound/api-client';
import { UiStringsProvider } from '@proofhound/ui/strings';
import { I18nProvider, useI18n, type Language } from '../i18n';
import { DisplayPreferencesProvider } from './display-preferences-provider';
import { NavigationProvider } from './navigation-provider';
import { ProjectContextProvider } from './project-context-provider';
import { RefineProvider } from './refine-provider';
import { RuntimeLimitsProvider } from './runtime-limits-provider';
import type { WebContracts } from '../contracts';

export function ProofHoundWebProvider({
  contracts,
  children,
  defaultLanguage,
}: {
  contracts: WebContracts;
  children: ReactNode;
  defaultLanguage?: Language;
}) {
  // Wire the api client during the first render — before children mount — so a
  // child screen's first TanStack Query already carries the baseUrl,
  // Authorization, and X-Project-Id from WebContracts. A post-mount effect runs
  // *after* child effects, letting that first request escape unconfigured —
  // which matters once a consuming shell injects a non-default
  // baseUrl/token/project. The lazy useState initializer runs once on mount,
  // ahead of child render; SSR skips it because httpClient is client-only.
  useState(() => {
    if (typeof window !== 'undefined') {
      configureApiClient({
        authSource: contracts.authSource,
        getProjectId: () => contracts.projectContext.projectId,
        baseUrl: contracts.baseUrl,
      });
    }
    return null;
  });

  return (
    <I18nProvider defaultLanguage={defaultLanguage} extend={contracts.i18nExtend}>
      <DisplayPreferencesProvider value={contracts.displayPreferences}>
        <UiStringsBridge>
          <ProjectContextProvider value={contracts.projectContext}>
            <RuntimeLimitsProvider value={contracts.runtimeLimits}>
              <NavigationProvider resolveHref={contracts.resolveHref}>
                <RefineProvider>{children}</RefineProvider>
              </NavigationProvider>
            </RuntimeLimitsProvider>
          </ProjectContextProvider>
        </UiStringsBridge>
      </DisplayPreferencesProvider>
    </I18nProvider>
  );
}

// Bridges the i18n t() into @proofhound/ui's UiStringsContext so the ui primitives
// (table/dialog/table-action/platform-loader/resource-pagination-footer/image-preview-dialog)
// render localized strings. Keeps dependency direction web-ui → ui (ui never imports web-ui).
function UiStringsBridge({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <UiStringsProvider
      value={{
        tableEmpty: t('common.table.empty'),
        dialogClose: t('common.close'),
        actionsMore: t('common.actions.more'),
        loaderLabel: t('common.loadingEffort'),
        itemsPerPage: t('common.itemsPerPage'),
        imagePreviewFailed: t('datasets.detail.imagePreviewFailed'),
      }}
    >
      {children}
    </UiStringsProvider>
  );
}
