'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { AnnotationDetailScreen } from '@proofhound/web-ui/screens';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectAnnotationDetailRoute() {
  const params = useParams<{ annotationTaskId?: string | string[] }>();
  const { projectId } = useProjectContext();

  return (
    <AnnotationDetailScreen
      projectId={projectId}
      annotationTaskId={getParam(params.annotationTaskId)}
    />
  );
}
