export interface ProjectContext {
  projectId: string;
  source: 'local';
  /**
   * Override-only: the org this project belongs to. Carried so a replacement implementation's LimiterKeyStrategy can derive an
   * org-scoped rate-limit key (e.g. `org:<orgId>:model:<id>`) without re-querying. OSS never sets it,
   * and the default LocalLimiterKeyStrategy ignores it. Mirrors ActorContext.orgId.
   */
  orgId?: string;
}

export const LOCAL_PROJECT_ID = '00000000-0000-4000-8000-000000000001';

export const LOCAL_PROJECT_CONTEXT: ProjectContext = Object.freeze({
  projectId: LOCAL_PROJECT_ID,
  source: 'local',
});
