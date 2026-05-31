'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { AnnotationsListScreen } from '@proofhound/web-ui/screens';

export default function ProjectAnnotationsPage() {
  const { projectId } = useProjectContext();
  return <AnnotationsListScreen projectId={projectId} />;
}
