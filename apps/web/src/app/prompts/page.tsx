'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { PromptsListPage } from './_components/prompts-list-page';

export default function ProjectPromptsPage() {
  const { projectId } = useProjectContext();

  return <PromptsListPage projectId={projectId} />;
}
