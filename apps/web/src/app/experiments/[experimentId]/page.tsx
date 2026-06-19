'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { DetailPageLoading } from '@proofhound/ui';
import { useMounted } from '@proofhound/web-ui/hooks';
import { ExperimentDetailScreen } from '@proofhound/web-ui/screens';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectExperimentDetailPage() {
  const params = useParams<{ experimentId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const experimentId = getParam(params.experimentId);
  const mounted = useMounted();

  // Hydration gate (see useMounted): keep the server render and the client's first paint
  // identical, since the screen's data comes from a client-only React Query cache.
  if (!mounted) return <DetailPageLoading />;
  return <ExperimentDetailScreen projectId={projectId} experimentId={experimentId} />;
}
