import type { DatasetModalityDto } from '@proofhound/shared';
import type { TranslationKey } from '../../i18n';

export type DatasetModality = DatasetModalityDto;
export type DatasetStatus = 'active' | 'deleted';
export type DatasetFieldRole = 'id' | 'text' | 'image' | 'expected' | 'metadata';

export interface DatasetField {
  name: string;
  role: DatasetFieldRole;
  preview: string;
  hint?: string;
}

export interface DatasetCategorySlice {
  label: string;
  count: number;
  percent: number;
  colorClass?: string;
}

export interface DatasetCategoryProfile {
  field?: string;
  total?: number;
  slices: DatasetCategorySlice[];
  openOutput?: boolean;
}

export interface DatasetReferences {
  experiments: number;
  optimizations: number;
  completedExperiments?: number;
}

export interface ProjectDataset {
  id: string;
  name: string;
  description: string;
  owner: string;
  uploadSource: string;
  modalities: DatasetModality[];
  hasImages: boolean;
  status: DatasetStatus;
  sampleCount: number;
  sizeMb: number;
  fieldCount: number;
  categoryProfile: DatasetCategoryProfile;
  references: DatasetReferences;
  createdAt: string;
  updatedAt: string;
  createdAtRaw: string;
  updatedAtRaw: string;
  fields: DatasetField[];
}

export interface DatasetSample {
  id: string;
  data: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
}

export const DATASET_MODALITY_LABEL_KEYS: Record<DatasetModality, TranslationKey> = {
  text: 'datasets.modality.text',
  image: 'datasets.modality.image',
};

export const DATASET_ROLE_LABEL_KEYS: Record<DatasetFieldRole, TranslationKey> = {
  id: 'datasets.role.id',
  text: 'datasets.role.text',
  image: 'datasets.role.image',
  expected: 'datasets.role.expected',
  metadata: 'datasets.role.metadata',
};

export function getReferenceCount(dataset: ProjectDataset) {
  return (
    dataset.references.experiments + dataset.references.optimizations + (dataset.references.completedExperiments ?? 0)
  );
}
