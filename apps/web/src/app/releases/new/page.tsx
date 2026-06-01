'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ReleaseNewScreen } from '@proofhound/web-ui/screens';

export default function ProjectReleaseNewRoute() {
  const { projectId } = useProjectContext();
  return <ReleaseNewScreen projectId={projectId} />;
}
