'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ConnectorFormScreen } from '@proofhound/web-ui/screens';

export default function ProjectConnectorNewPage() {
  const { projectId } = useProjectContext();
  return <ConnectorFormScreen mode="create" projectId={projectId} />;
}
