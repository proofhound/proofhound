'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { ModelFormScreen } from '@proofhound/web-ui/screens';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function EditProjectModelPage() {
  const params = useParams<{ modelId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const modelId = getParam(params.modelId);

  return <ModelFormScreen mode="edit" projectId={projectId} modelId={modelId} />;
}
