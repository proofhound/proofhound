'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { AnnotationsListPage } from './_components/annotations-list-page';

export default function ProjectAnnotationsPage() {
  const { projectId } = useProjectContext();
  return <AnnotationsListPage projectId={projectId} />;
}
