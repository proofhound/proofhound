'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { ReleaseLineDetailPage } from '../_components/release-line-detail-page';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectReleaseLineDetailRoute() {
  const params = useParams<{ releaseLineId?: string | string[] }>();
  const { projectId } = useProjectContext();
  return (
    <ReleaseLineDetailPage
      projectId={projectId}
      releaseLineId={getParam(params.releaseLineId)}
    />
  );
}
