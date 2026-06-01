'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { OptimizationsListScreen } from '@proofhound/web-ui/screens';

export default function ProjectOptimizationsPage() {
  const { projectId } = useProjectContext();

  return <OptimizationsListScreen projectId={projectId} />;
}
