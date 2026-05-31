'use client';

import { useProjectContext } from '@proofhound/web-ui/providers';
import { ConnectorFormPage } from '../_components/connector-form-page';

export default function ProjectConnectorNewPage() {
  const { projectId } = useProjectContext();
  return <ConnectorFormPage mode="create" projectId={projectId} />;
}
