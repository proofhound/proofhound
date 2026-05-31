'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { AnnotationNewScreen } from '@proofhound/web-ui/screens';

export default function ProjectAnnotationNewRoute() {
  const { projectId } = useProjectContext();
  return <AnnotationNewScreen projectId={projectId} />;
}
