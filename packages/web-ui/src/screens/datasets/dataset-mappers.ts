import { deriveDatasetModalities, type DatasetFieldSchemaDto, type DatasetListItemDto } from '@proofhound/shared';
import type { DatasetFieldRole, ProjectDataset } from './dataset-types';

function isIdLikeField(name: string) {
  const normalized = name.toLowerCase();
  return normalized === 'id' || normalized === 'sample_id';
}

export function toUiFieldRole(field: DatasetFieldSchemaDto): DatasetFieldRole {
  if (field.role === 'expected_output') return 'expected';
  if (field.role === 'image' || field.role === 'image_url' || field.role === 'image_base64') return 'image';
  if (field.role === 'text') return 'text';
  if (isIdLikeField(field.name)) return 'id';
  return 'metadata';
}

function getStorageFileName(storagePrefix: string | null) {
  if (!storagePrefix) return '-';
  return storagePrefix.split('/').filter(Boolean).at(-1) ?? storagePrefix;
}

function toCategoryPercent(count: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function toCategoryProfile(dataset: DatasetListItemDto) {
  const expectedOutputField = dataset.fieldSchema.find((field) => field.role === 'expected_output');
  const distribution = dataset.categoryDistribution ?? {
    field: expectedOutputField?.name ?? null,
    total: 0,
    categories: [],
  };
  const field = distribution.field ?? expectedOutputField?.name;
  const categories = distribution.categories;
  const total =
    distribution.total > 0 ? distribution.total : categories.reduce((sum, category) => sum + category.count, 0);

  if (!field) return { total: 0, slices: [] };

  return {
    field,
    total,
    slices: categories.map((category) => ({
      label: category.label,
      count: category.count,
      percent: toCategoryPercent(category.count, total),
    })),
    openOutput: categories.length === 0,
  };
}

export function toProjectDataset(dataset: DatasetListItemDto): ProjectDataset {
  return {
    id: dataset.id,
    name: dataset.name,
    description: dataset.description ?? '',
    owner: dataset.createdByDisplayName ?? dataset.createdBy,
    uploadSource: getStorageFileName(dataset.storagePrefix),
    modalities: deriveDatasetModalities(dataset.fieldSchema),
    hasImages: dataset.hasImages,
    status: dataset.status,
    sampleCount: dataset.sampleCount,
    sizeMb: 0,
    fieldCount: dataset.fieldSchema.length,
    fields: dataset.fieldSchema.map((field) => ({
      name: field.name,
      role: toUiFieldRole(field),
      preview: field.type,
    })),
    categoryProfile: toCategoryProfile(dataset),
    references: {
      experiments: dataset.references?.experiments ?? 0,
      optimizations: dataset.references?.optimizations ?? 0,
    },
    createdAt: dataset.createdAt,
    updatedAt: dataset.updatedAt,
    createdAtRaw: dataset.createdAt,
    updatedAtRaw: dataset.updatedAt,
  };
}
