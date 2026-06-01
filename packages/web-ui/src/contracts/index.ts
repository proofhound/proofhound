import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import { LocalAuthSource, type AuthSource } from '@proofhound/api-client';
import type { Language } from '../i18n';

export interface WebContracts {
  authSource: AuthSource;
  projectContext: ProjectContext; // OSS: LOCAL_PROJECT_CONTEXT. (SaaS reactive multi-tenant source is a future extension.)
  baseUrl?: string;
  i18nExtend?: Partial<Record<Language, Record<string, string>>>;
}

export const localWebContracts: WebContracts = {
  authSource: new LocalAuthSource(),
  projectContext: LOCAL_PROJECT_CONTEXT,
};
