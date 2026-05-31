'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ModelsListScreen } from '@proofhound/web-ui/screens';

export default function ProjectModelsPage() {
  const { projectId } = useProjectContext();

  return <ModelsListScreen projectId={projectId} />;
}
