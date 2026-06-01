'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@proofhound/web-ui/providers';
import { Main } from '@proofhound/ui/layout';
import { Button, DetailPageSkeleton } from '@proofhound/ui';
import { useDataset } from '@proofhound/web-ui/hooks';
import { useI18n } from '@proofhound/web-ui/i18n';
import { isCanonicalUuid } from '@proofhound/web-ui/lib';
import { DatasetDetailScreen, toProjectDataset } from '@proofhound/web-ui/screens';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectDatasetDetailRoute() {
  const { t } = useI18n();
  const params = useParams<{ datasetId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const datasetId = getParam(params.datasetId);
  const canUseApi = isCanonicalUuid(projectId) && isCanonicalUuid(datasetId);
  // Samples are fetched inside DatasetDetailScreen (server-paginated); the route only resolves dataset metadata.
  const datasetQuery = useDataset(canUseApi ? projectId : '', canUseApi ? datasetId : '');

  const dataset = datasetQuery.data ? toProjectDataset(datasetQuery.data) : null;

  // Show the skeleton until the dataset query has actually settled. Without this the page briefly renders the
  // "not found" card during SSR / before the client query resolves (projectId is client-only) — the Not-Found flash.
  const settled = canUseApi && datasetQuery.isFetched && !datasetQuery.isFetching;
  if (!dataset && !settled) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="dataset-detail-page">
          <DetailPageSkeleton />
        </div>
      </Main>
    );
  }

  if (!dataset) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-8" data-testid="dataset-detail-page">
          <div className="rounded-lg border bg-card p-8 text-center">
            <h1 className="text-xl font-semibold">{t('common.notFound')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('datasets.detail.notFoundDescription')}</p>
            <Button asChild className="mt-4">
              <a href={`/datasets`}>{t('datasets.title')}</a>
            </Button>
          </div>
        </div>
      </Main>
    );
  }

  return <DatasetDetailScreen key={dataset.id} projectId={projectId} dataset={dataset} />;
}
