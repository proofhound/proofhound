'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ReleasesListScreen } from '@proofhound/web-ui/screens';

export default function ProjectReleasesPage() {
  const { projectId } = useProjectContext();
  return <ReleasesListScreen projectId={projectId} />;
}
