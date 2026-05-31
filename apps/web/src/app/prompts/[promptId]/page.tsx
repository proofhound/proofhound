'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { PromptDetailScreen } from '@proofhound/web-ui/screens';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectPromptDetailRoute() {
  const params = useParams<{ promptId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const promptId = getParam(params.promptId);

  return <PromptDetailScreen projectId={projectId} promptId={promptId} />;
}
