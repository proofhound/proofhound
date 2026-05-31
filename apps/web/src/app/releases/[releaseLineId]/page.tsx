'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { ReleaseLineDetailScreen } from '@proofhound/web-ui/screens';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectReleaseLineDetailRoute() {
  const params = useParams<{ releaseLineId?: string | string[] }>();
  const { projectId } = useProjectContext();
  return (
    <ReleaseLineDetailScreen
      projectId={projectId}
      releaseLineId={getParam(params.releaseLineId)}
    />
  );
}
