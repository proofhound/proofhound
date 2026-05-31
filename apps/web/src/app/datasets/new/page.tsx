'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { DatasetUploadPage } from '../_components/dataset-upload-page';

export default function ProjectDatasetUploadRoute() {
  const { projectId } = useProjectContext();

  return <DatasetUploadPage projectId={projectId} />;
}
