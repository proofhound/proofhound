'use client';

import { type ReactNode, useEffect } from 'react';
import { configureApiClient } from '@proofhound/api-client';
import { UiStringsProvider } from '@proofhound/ui/strings';
import { I18nProvider, useI18n, type Language } from '../i18n';
import { ProjectContextProvider } from './project-context-provider';
import { RefineProvider } from './refine-provider';
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
  useEffect(() => {
    configureApiClient({
      authSource: contracts.authSource,
      getProjectId: () => contracts.projectContext.projectId,
      baseUrl: contracts.baseUrl,
    });
  }, [contracts]);

  return (
    <I18nProvider defaultLanguage={defaultLanguage} extend={contracts.i18nExtend}>
      <UiStringsBridge>
        <ProjectContextProvider value={contracts.projectContext}>
          <RefineProvider>{children}</RefineProvider>
        </ProjectContextProvider>
      </UiStringsBridge>
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
