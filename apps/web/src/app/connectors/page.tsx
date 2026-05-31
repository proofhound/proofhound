'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ConnectorsListPage } from './_components/connectors-list-page';

export default function ProjectConnectorsPage() {
  const { projectId } = useProjectContext();
  return <ConnectorsListPage projectId={projectId} />;
}
