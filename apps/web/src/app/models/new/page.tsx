'use client';

import { useSearchParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { ModelFormScreen } from '@proofhound/web-ui/screens';

export default function NewProjectModelPage() {
  const { projectId } = useProjectContext();
  const searchParams = useSearchParams();
  const copyFromId = searchParams.get('copyFrom') ?? undefined;

  return <ModelFormScreen mode="new" projectId={projectId} copyFromId={copyFromId} />;
}
