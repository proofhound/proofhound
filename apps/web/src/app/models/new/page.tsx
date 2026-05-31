'use client';

import { useSearchParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { ModelFormPage } from '../_components/model-form-page';

export default function NewProjectModelPage() {
  const { projectId } = useProjectContext();
  const searchParams = useSearchParams();
  const copyFromId = searchParams.get('copyFrom') ?? undefined;

  return <ModelFormPage mode="new" projectId={projectId} copyFromId={copyFromId} />;
}
