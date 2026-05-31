'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ExperimentsListPage } from './_components/experiments-list-page';

export default function ProjectExperimentsPage() {
  const { projectId } = useProjectContext();

  return <ExperimentsListPage projectId={projectId} />;
}
