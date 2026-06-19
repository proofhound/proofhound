'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { DetailPageLoading } from '@proofhound/ui';
import { useMounted } from '@proofhound/web-ui/hooks';
import { ReleaseLineDetailScreen } from '@proofhound/web-ui/screens';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectReleaseLineDetailRoute() {
  const params = useParams<{ releaseLineId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const mounted = useMounted();

  // Hydration gate (see useMounted): keep the server render and the client's first paint
  // identical, since the screen's data comes from a client-only React Query cache.
  if (!mounted) return <DetailPageLoading />;
  return (
    <ReleaseLineDetailScreen
      projectId={projectId}
      releaseLineId={getParam(params.releaseLineId)}
    />
  );
}
