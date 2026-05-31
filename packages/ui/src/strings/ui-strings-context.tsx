'use client';
import { createContext, useContext, type ReactNode } from 'react';

/**
 * Injected UI string contract for @proofhound/ui primitives.
 *
 * Fields map 1-to-1 with every distinct t() call in the 6 coupled primitives
 * (table, dialog, table-action, platform-loader, resource-pagination-footer,
 * image-preview-dialog). Later tasks (T5) will replace each t() call with
 * the corresponding field from useUiStrings(), eliminating the
 * @proofhound/ui → @proofhound/web-ui dependency cycle.
 *
 * apps/web's ProofHoundWebProvider (T12) will fill these with localized t() values.
 */
export interface UiStrings {
  /** table.tsx: TableEmpty fallback — t('common.table.empty') */
  tableEmpty: string;
  /** dialog.tsx: DialogContent close button sr-only label — t('common.close') */
  dialogClose: string;
  /** table-action.tsx: ⋯ overflow trigger label — t('common.actions.more') */
  actionsMore: string;
  /** platform-loader.tsx: loader aria-label + visible text — t('common.loadingEffort') */
  loaderLabel: string;
  /** resource-pagination-footer.tsx: items-per-page label — t('common.itemsPerPage') */
  itemsPerPage: string;
  /** image-preview-dialog.tsx: failed-load fallback text — t('datasets.detail.imagePreviewFailed') */
  imagePreviewFailed: string;
}

export const DEFAULT_UI_STRINGS: UiStrings = {
  tableEmpty: 'No data',
  dialogClose: 'Close',
  actionsMore: 'More actions',
  loaderLabel: 'Loading…',
  itemsPerPage: 'Items per page',
  imagePreviewFailed: 'Preview unavailable',
};

const Ctx = createContext<UiStrings>(DEFAULT_UI_STRINGS);

export function UiStringsProvider({
  value,
  children,
}: {
  value: Partial<UiStrings>;
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ ...DEFAULT_UI_STRINGS, ...value }}>{children}</Ctx.Provider>;
}

export function useUiStrings(): UiStrings {
  return useContext(Ctx);
}
