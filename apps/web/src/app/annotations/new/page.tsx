'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { AnnotationNewPage } from '../_components/annotation-new-page';

export default function ProjectAnnotationNewRoute() {
  const { projectId } = useProjectContext();
  return <AnnotationNewPage projectId={projectId} />;
}
