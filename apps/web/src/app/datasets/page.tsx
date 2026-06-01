'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { DatasetsListScreen } from '@proofhound/web-ui/screens';

export default function ProjectDatasetsPage() {
  const { projectId } = useProjectContext();

  return <DatasetsListScreen projectId={projectId} />;
}
