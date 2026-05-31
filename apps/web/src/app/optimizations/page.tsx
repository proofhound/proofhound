'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { OptimizationsListPage } from './_components/optimizations-list-page';

export default function ProjectOptimizationsPage() {
  const { projectId } = useProjectContext();

  return <OptimizationsListPage projectId={projectId} />;
}
