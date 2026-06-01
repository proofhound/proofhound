export interface ProjectNamedResource {
  id?: string | null;
  name?: string | null;
}

export function normalizeProjectName(name: string | null | undefined): string {
  return String(name ?? '').trim();
}

export function isProjectNameTaken(
  name: string | null | undefined,
  resources: ReadonlyArray<ProjectNamedResource>,
  currentResourceId?: string | null,
): boolean {
  const normalized = normalizeProjectName(name);
  if (!normalized) return false;

  return resources.some((resource) => {
    if (currentResourceId && resource.id === currentResourceId) return false;
    return normalizeProjectName(resource.name) === normalized;
  });
}
