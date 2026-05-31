'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { DatasetsListPage } from './_components/datasets-list-page';

export default function ProjectDatasetsPage() {
  const { projectId } = useProjectContext();

  return <DatasetsListPage projectId={projectId} />;
}
