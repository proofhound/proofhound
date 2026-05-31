'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ModelsListPage } from './_components/models-list-page';

export default function ProjectModelsPage() {
  const { projectId } = useProjectContext();

  return <ModelsListPage projectId={projectId} />;
}
