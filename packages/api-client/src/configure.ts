import { httpClient } from './http';
import type { AuthSource } from './auth-source';

export interface ApiClientConfig {
  authSource: AuthSource;
  /** Returns the current project ID to attach as X-Project-Id. */
  getProjectId: () => string;
  /** When provided, overrides httpClient.defaults.baseURL. */
  baseUrl?: string;
}

/**
 * Tracks the interceptor registered by the most recent configureApiClient call
 * so that re-configuring ejects the previous interceptor first (idempotent).
 */
let interceptorId: number | null = null;

/**
 * configureApiClient — wire Authorization and X-Project-Id interceptors.
 *
 * Call once on app init (e.g. from ProofHoundWebProvider) with the resolved
 * AuthSource and project accessor. Re-calling is safe: the previous
 * interceptor is ejected before a new one is registered, so headers are
 * never doubled.
 *
 * Spec: 08 §4.1 / §4.2
 */
export function configureApiClient(config: ApiClientConfig): void {
  if (config.baseUrl) {
    httpClient.defaults.baseURL = config.baseUrl;
  }

  // Eject the previously registered interceptor to avoid stacking on re-config.
  if (interceptorId !== null) {
    httpClient.interceptors.request.eject(interceptorId);
    interceptorId = null;
  }

  interceptorId = httpClient.interceptors.request.use(async (req) => {
    const token = await config.authSource.getToken();
    if (token) {
      req.headers.set('Authorization', `Bearer ${token}`);
    }
    const pid = config.getProjectId();
    if (pid) {
      req.headers.set('X-Project-Id', pid);
    }
    return req;
  });
}
