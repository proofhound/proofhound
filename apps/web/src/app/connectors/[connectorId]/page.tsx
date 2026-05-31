'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { ConnectorDetailPage } from '../_components/connector-detail-page';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectConnectorDetailRoute() {
  const params = useParams<{ connectorId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const connectorId = getParam(params.connectorId);
  return <ConnectorDetailPage projectId={projectId} connectorId={connectorId} />;
}
