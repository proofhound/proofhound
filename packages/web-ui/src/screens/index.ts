// Public screen API for @proofhound/web-ui/screens.
// Each product screen body is exported under a *Screen name; apps/web (and a future
// SaaS shell) wrap these in thin route pages. Component bodies keep their *Page names
// internally and are aliased here.

// annotations
export { AnnotationsListPage as AnnotationsListScreen } from './annotations/annotations-list-page';
export { AnnotationDetailPage as AnnotationDetailScreen } from './annotations/annotation-detail-page';
export { AnnotationNewPage as AnnotationNewScreen } from './annotations/annotation-new-page';

// connectors
export { ConnectorsListPage as ConnectorsListScreen } from './connectors/connectors-list-page';
export { ConnectorDetailPage as ConnectorDetailScreen } from './connectors/connector-detail-page';
export { ConnectorFormPage as ConnectorFormScreen } from './connectors/connector-form-page';

// datasets
export { DatasetsListPage as DatasetsListScreen } from './datasets/datasets-list-page';
export { DatasetDetailPage as DatasetDetailScreen } from './datasets/dataset-detail-page';
export { DatasetUploadPage as DatasetUploadScreen } from './datasets/dataset-upload-page';
export { toProjectDataset } from './datasets/dataset-mappers';
export type { ProjectDataset } from './datasets/dataset-types';

// experiments
export { ExperimentsListPage as ExperimentsListScreen } from './experiments/experiments-list-page';
export { ExperimentDetailPage as ExperimentDetailScreen } from './experiments/experiment-detail-page';
export { ExperimentNewPage as ExperimentNewScreen } from './experiments/experiment-new-page';

// models
export { ModelsListPage as ModelsListScreen } from './models/models-list-page';
export { ModelFormPage as ModelFormScreen } from './models/model-form-page';

// monitoring
export { ProjectMonitoringPage as ProjectMonitoringScreen } from './monitoring/project-monitoring-page';

// optimizations
export { OptimizationsListPage as OptimizationsListScreen } from './optimizations/optimizations-list-page';
export { OptimizationDetailPage as OptimizationDetailScreen } from './optimizations/optimization-detail-page';
export { OptimizationNewPage as OptimizationNewScreen } from './optimizations/optimization-new-page';

// prompts
export { PromptsListPage as PromptsListScreen } from './prompts/prompts-list-page';
export { PromptDetailPage as PromptDetailScreen } from './prompts/prompt-detail-page';

// releases
export { ReleasesListPage as ReleasesListScreen } from './releases/releases-list-page';
export { ReleaseLineDetailPage as ReleaseLineDetailScreen } from './releases/release-line-detail-page';
export { ReleaseNewPage as ReleaseNewScreen } from './releases/release-new-page';

// settings
export { SettingsPage as SettingsScreen } from './settings/settings-page';

// dashboard / quick-start (extracted fat pages — already named *Screen)
export { DashboardScreen } from './dashboard/dashboard-screen';
export { QuickStartScreen } from './quick-start/quick-start-screen';
