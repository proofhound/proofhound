'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ConnectorsListScreen } from '@proofhound/web-ui/screens';

export default function ProjectConnectorsPage() {
  const { projectId } = useProjectContext();
  return <ConnectorsListScreen projectId={projectId} />;
}
