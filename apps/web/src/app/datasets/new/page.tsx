'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { DatasetUploadScreen } from '@proofhound/web-ui/screens';

export default function ProjectDatasetUploadRoute() {
  const { projectId } = useProjectContext();

  return <DatasetUploadScreen projectId={projectId} />;
}
