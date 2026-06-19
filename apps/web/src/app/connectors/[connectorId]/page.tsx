'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { DetailPageLoading } from '@proofhound/ui';
import { useMounted } from '@proofhound/web-ui/hooks';
import { ConnectorDetailScreen } from '@proofhound/web-ui/screens';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectConnectorDetailRoute() {
  const params = useParams<{ connectorId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const connectorId = getParam(params.connectorId);
  const mounted = useMounted();
  // Hydration gate (see useMounted): keep the server render and the client's first paint
  // identical, since the screen's data comes from a client-only React Query cache.
  if (!mounted) return <DetailPageLoading />;
  return <ConnectorDetailScreen projectId={projectId} connectorId={connectorId} />;
}
