import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import { LocalAuthSource, type AuthSource } from '@proofhound/api-client';
import type { Language } from '../i18n';
import type { DisplayPreferencesContract } from '../providers/display-preferences-provider';
import type { ResolveHref } from '../providers/navigation-provider';
import type { RuntimeLimitsUiContract } from '../providers/runtime-limits-provider';

export interface WebContracts {
  authSource: AuthSource;
  projectContext: ProjectContext; // OSS: LOCAL_PROJECT_CONTEXT. (SaaS reactive multi-tenant source is a future extension.)
  baseUrl?: string;
  i18nExtend?: Partial<Record<Language, Record<string, string>>>;
  displayPreferences?: DisplayPreferencesContract;
  runtimeLimits?: RuntimeLimitsUiContract;
  // Rewrites in-app hrefs to the hosting shell's real routes. OSS omits it
  // (identity). SaaS injects a resolver that scopes flat product paths to
  // `/app/org/:orgId/project/:projectId/...`.
  resolveHref?: ResolveHref;
}

export const localWebContracts: WebContracts = {
  authSource: new LocalAuthSource(),
  projectContext: LOCAL_PROJECT_CONTEXT,
};
