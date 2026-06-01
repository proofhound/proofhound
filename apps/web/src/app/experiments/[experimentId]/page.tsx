'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { ExperimentDetailScreen } from '@proofhound/web-ui/screens';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectExperimentDetailPage() {
  const params = useParams<{ experimentId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const experimentId = getParam(params.experimentId);

  return <ExperimentDetailScreen projectId={projectId} experimentId={experimentId} />;
}
