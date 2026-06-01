import type { DatasetField, DatasetFieldRole, DatasetSample } from './dataset-types';
import { getDisplayValue } from './dataset-upload-parser';

export type ImageSourceType = 'url' | 'base64' | 'file' | 'empty';

export function getImageReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return getImageReferences(parsed);
    } catch {
      // Fall back to treating the original string as a single image reference.
    }
  }

  return trimmed ? [trimmed] : [];
}

export function parseImageReferenceArrayInput(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return null;
    return getImageReferences(parsed);
  } catch {
    return null;
  }
}

export function getPrimaryImageReference(value: unknown): string {
  return getImageReferences(value)[0] ?? getDisplayValue(value);
}

export function getImageSourceType(value: unknown): ImageSourceType {
  const trimmed = getPrimaryImageReference(value).trim();
  if (!trimmed) return 'empty';
  if (/^https?:\/\//iu.test(trimmed)) return 'url';
  if (/^data:image\//iu.test(trimmed)) return 'base64';
  return 'file';
}

export function inferMissingFieldRole(fieldName: string): DatasetFieldRole {
  const normalized = fieldName.toLowerCase();
  if (normalized === 'id' || normalized === 'sample_id') return 'id';
  return 'metadata';
}

export function mergeFieldsWithSampleData(fields: DatasetField[], samples: DatasetSample[]): DatasetField[] {
  const knownFields = new Set(fields.map((field) => field.name));
  const extraFields: DatasetField[] = [];

  for (const sample of samples) {
    for (const [fieldName, value] of Object.entries(sample.data)) {
      if (knownFields.has(fieldName)) continue;
      knownFields.add(fieldName);
      extraFields.push({
        name: fieldName,
        role: inferMissingFieldRole(fieldName),
        preview: getDisplayValue(value) || '-',
      });
    }
  }

  return [...fields, ...extraFields];
}

export function normalizeExpectedRoles(fields: DatasetField[], preferredName: string | null): DatasetField[] {
  let kept: string | null =
    preferredName && fields.some((field) => field.name === preferredName && field.role === 'expected')
      ? preferredName
      : null;
  if (!kept) kept = fields.find((field) => field.role === 'expected')?.name ?? null;
  if (!kept) return fields;

  return fields.map((field) =>
    field.role === 'expected' && field.name !== kept ? { ...field, role: 'metadata' as DatasetFieldRole } : field,
  );
}
