'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ProjectContext } from '@proofhound/shared';

const CurrentProjectContext = createContext<ProjectContext | null>(null);

export function ProjectContextProvider({ value, children }: { value: ProjectContext; children: ReactNode }) {
  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>;
}

export function useProjectContext(): ProjectContext {
  const ctx = useContext(CurrentProjectContext);
  if (!ctx) {
    throw new Error('project_context_provider_missing');
  }
  return ctx;
}
