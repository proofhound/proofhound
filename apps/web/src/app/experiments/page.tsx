'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ExperimentsListScreen } from '@proofhound/web-ui/screens';

export default function ProjectExperimentsPage() {
  const { projectId } = useProjectContext();

  return <ExperimentsListScreen projectId={projectId} />;
}
