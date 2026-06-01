'use client';

import { DashboardScreen } from '@proofhound/web-ui/screens';
import { useProjectContext } from '@proofhound/web-ui/providers';

export default function DashboardPage() {
  const { projectId } = useProjectContext();

  return <DashboardScreen projectId={projectId} />;
}
