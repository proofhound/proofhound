'use client';

import { useMemo, type ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { localWebContracts, type WebContracts } from '@proofhound/web-ui/contracts';
import { type Language } from '@proofhound/web-ui/i18n/language';
import { ProofHoundWebProvider } from '@proofhound/web-ui/providers';

/**
 * Client boundary that owns the OSS `localWebContracts` and mounts `ProofHoundWebProvider`.
 *
 * Why this wrapper exists: `localWebContracts.authSource` is a class instance (`LocalAuthSource`),
 * and React Server Components cannot pass class instances across the server→client prop boundary.
 * The root `layout.tsx` is an async Server Component, so it must NOT pass `contracts` directly to
 * the client `ProofHoundWebProvider`. Instead the layout passes only serializable data
 * (`defaultLanguage`, `datasetUploadMaxBytes`) + `children`, and this 'use client' module
 * constructs/imports the contracts entirely on the client side. A replacement app writes its own
 * equivalent wrapper with its own override `WebContracts`.
 */
export function Providers({
  defaultLanguage,
  datasetUploadMaxBytes,
  children,
}: {
  defaultLanguage: Language;
  datasetUploadMaxBytes: number;
  children: ReactNode;
}) {
  const contracts = useMemo<WebContracts>(
    () => ({ ...localWebContracts, datasetUploadMaxBytes }),
    [datasetUploadMaxBytes],
  );

  return (
    <ProofHoundWebProvider contracts={contracts} defaultLanguage={defaultLanguage}>
      <AppShell>{children}</AppShell>
    </ProofHoundWebProvider>
  );
}
