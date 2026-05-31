'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { AnnotationDetailPage } from '../_components/annotation-detail-page';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectAnnotationDetailRoute() {
  const params = useParams<{ annotationTaskId?: string | string[] }>();
  const { projectId } = useProjectContext();

  return (
    <AnnotationDetailPage
      projectId={projectId}
      annotationTaskId={getParam(params.annotationTaskId)}
    />
  );
}
