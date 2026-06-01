import type { DatasetFieldMappingDto, DatasetFieldSchemaDto, DatasetFieldSchemaRole } from '@proofhound/shared';

// Derives the persisted field schema (role + inferred type) from user field mappings and a sample of rows.
// Shared by the sync create path and the large-file import complete path.
export function buildDatasetFieldSchema(
  mappings: DatasetFieldMappingDto[],
  samples: Array<Record<string, unknown>>,
): DatasetFieldSchemaDto[] {
  return mappings.map((field) => ({
    name: field.name,
    role: toSchemaRole(field, samples),
    type: inferFieldType(field.name, samples),
  }));
}

export function inferFieldType(
  fieldName: string,
  samples: Array<Record<string, unknown>>,
): DatasetFieldSchemaDto['type'] {
  const value = samples.map((sample) => sample[fieldName]).find((item) => item !== undefined);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'object') return type;
  return 'unknown';
}

function toSchemaRole(field: DatasetFieldMappingDto, samples: Array<Record<string, unknown>>): DatasetFieldSchemaRole {
  if (field.role === 'expected') return 'expected_output';
  if (field.role === 'id') return 'metadata';
  if (field.role !== 'image') return field.role;

  const firstValue = samples.map((sample) => firstImageReference(sample[field.name])).find(Boolean);
  if (!firstValue) return 'image';
  if (/^https?:\/\//iu.test(firstValue)) return 'image_url';
  if (/^data:image\//iu.test(firstValue)) return 'image_base64';
  return 'image';
}

function firstImageReference(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }

  return null;
}
