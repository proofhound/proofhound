'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { PromptDetailPage } from '../_components/prompt-detail-page';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectPromptDetailRoute() {
  const params = useParams<{ promptId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const promptId = getParam(params.promptId);

  return <PromptDetailPage projectId={projectId} promptId={promptId} />;
}
