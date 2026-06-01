'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { PromptsListScreen } from '@proofhound/web-ui/screens';

export default function ProjectPromptsPage() {
  const { projectId } = useProjectContext();

  return <PromptsListScreen projectId={projectId} />;
}
