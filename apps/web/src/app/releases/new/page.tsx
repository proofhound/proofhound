'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ReleaseNewPage } from '../_components/release-new-page';

export default function ProjectReleaseNewRoute() {
  const { projectId } = useProjectContext();
  return <ReleaseNewPage projectId={projectId} />;
}
