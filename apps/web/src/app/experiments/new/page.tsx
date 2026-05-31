'use client';

import { useSearchParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { ExperimentNewScreen } from '@proofhound/web-ui/screens';

export default function ProjectExperimentNewPage() {
  const searchParams = useSearchParams();
  const { projectId } = useProjectContext();
  const initialPromptId = searchParams.get('promptId') ?? null;
  const initialPromptVersionId = searchParams.get('promptVersionId') ?? null;
  const initialDatasetId = searchParams.get('datasetId') ?? null;
  const initialModelId = searchParams.get('modelId') ?? null;
  const initialDatasetName = searchParams.get('datasetName') ?? null;
  const initialDatasetSampleCount = searchParams.get('sampleCount') ?? null;
  const initialName = searchParams.get('name') ?? null;
  const initialDescription = searchParams.get('description') ?? null;
  const initialConcurrency = searchParams.get('concurrency') ?? null;
  const initialRpmLimit = searchParams.get('rpmLimit') ?? null;
  const initialTpmLimit = searchParams.get('tpmLimit') ?? null;
  const initialTemperature = searchParams.get('temperature') ?? null;
  const initialSampleTimeoutSeconds = searchParams.get('sampleTimeoutSeconds') ?? null;
  const initialRetries = searchParams.get('retries') ?? null;
  const initialImageEncoding = searchParams.get('imageEncoding') ?? null;

  return (
    <ExperimentNewScreen
      projectId={projectId}
      initialPromptId={initialPromptId}
      initialPromptVersionId={initialPromptVersionId}
      initialDatasetId={initialDatasetId}
      initialModelId={initialModelId}
      initialDatasetName={initialDatasetName}
      initialDatasetSampleCount={initialDatasetSampleCount}
      initialName={initialName}
      initialDescription={initialDescription}
      initialConcurrency={initialConcurrency}
      initialRpmLimit={initialRpmLimit}
      initialTpmLimit={initialTpmLimit}
      initialTemperature={initialTemperature}
      initialSampleTimeoutSeconds={initialSampleTimeoutSeconds}
      initialRetries={initialRetries}
      initialImageEncoding={initialImageEncoding}
    />
  );
}
