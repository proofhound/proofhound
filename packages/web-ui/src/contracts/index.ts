import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import { LocalAuthSource, type AuthSource } from '@proofhound/api-client';
import type { Language } from '../i18n';
import type { DisplayPreferencesContract } from '../providers/display-preferences-provider';
import type { ResolveHref } from '../providers/navigation-provider';
import type { RuntimeLimitsUiContract } from '../providers/runtime-limits-provider';
import type { DatasetUploadAdapter } from '../providers/dataset-upload-provider';

export interface WebContracts {
  authSource: AuthSource;
  projectContext: ProjectContext; // OSS: LOCAL_PROJECT_CONTEXT. (A replacement implementation's reactive multi-tenant source is a future extension.)
  baseUrl?: string;
  webhookBaseUrl?: string;
  i18nExtend?: Partial<Record<Language, Record<string, string>>>;
  displayPreferences?: DisplayPreferencesContract;
  runtimeLimits?: RuntimeLimitsUiContract;
  // Rewrites in-app hrefs to the hosting shell's real routes. OSS omits it
  // (identity). A replacement implementation injects a resolver that scopes flat product paths to
  // `/app/org/:orgId/project/:projectId/...`.
  resolveHref?: ResolveHref;
  // Swappable dataset upload transport + UI size cap (08 §3.13). OSS omits both (multipart client +
  // DATASET_UPLOAD_MAX_BYTES). A replacement implementation injects its own upload implementation and/or a per-plan max.
  datasetUpload?: DatasetUploadAdapter;
  datasetUploadMaxBytes?: number;
}

export const localWebContracts: WebContracts = {
  authSource: new LocalAuthSource(),
  projectContext: LOCAL_PROJECT_CONTEXT,
};
