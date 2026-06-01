'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { OptimizationDetailScreen } from '@proofhound/web-ui/screens';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectOptimizationDetailPage() {
  const params = useParams<{ optimizationId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const optimizationId = getParam(params.optimizationId);

  return <OptimizationDetailScreen projectId={projectId} optimizationId={optimizationId} />;
}
