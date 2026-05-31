'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ReleasesListPage } from './_components/releases-list-page';

export default function ProjectReleasesPage() {
  const { projectId } = useProjectContext();
  return <ReleasesListPage projectId={projectId} />;
}
