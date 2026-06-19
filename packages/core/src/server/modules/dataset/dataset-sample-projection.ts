// Dataset-sample queryable projection (SPEC 22 §7.1) — pure logic.
//
// When a sample's full `data` tiers out to a shard, the DB keeps a small projection so list / search /
// distribution stay in SQL: a search preview, the expected-output role scalar, and an index_values
// sidecar holding the other short scalar fields (for distribution / filter on any configurable field).
//
// Note: field_schema roles are text / image* / expected_output / metadata — there is no label/category
// role (distribution targets a configurable field name, not a fixed role), so label_scalar /
// category_scalar stay reserved and distribution reads index_values.
import type { DatasetFieldSchemaDto } from '@proofhound/shared';

export interface DatasetSampleProjection {
  searchPreview: string | null;
  expectedOutputScalar: string | null;
  labelScalar: string | null;
  categoryScalar: string | null;
  indexValues: Record<string, string> | null;
}

const PREVIEW_MAX = 1000;
const SCALAR_MAX = 200;
const IMAGE_ROLES = new Set(['image', 'image_url', 'image_base64']);

function asScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > SCALAR_MAX ? null : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function previewOf(data: unknown): string | null {
  if (data === null || data === undefined) return null;
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  if (text.length === 0) return null;
  return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) : text;
}

/** Build the DB-side projection for one sample from its data + the dataset's field schema. */
export function projectDatasetSample(
  data: Record<string, unknown> | null,
  fieldSchema: DatasetFieldSchemaDto[],
): DatasetSampleProjection {
  if (data === null) {
    return { searchPreview: null, expectedOutputScalar: null, labelScalar: null, categoryScalar: null, indexValues: null };
  }

  const expectedField = fieldSchema.find((f) => f.role === 'expected_output')?.name;
  const expectedOutputScalar = expectedField ? asScalar(data[expectedField]) : null;

  // index_values: short scalar values of the non-image fields, so distribution / filter on any
  // configurable field works off `index_values->>field` once `data` is offloaded.
  const indexValues: Record<string, string> = {};
  for (const field of fieldSchema) {
    if (IMAGE_ROLES.has(field.role)) continue;
    const scalar = asScalar(data[field.name]);
    if (scalar !== null) indexValues[field.name] = scalar;
  }

  return {
    searchPreview: previewOf(data),
    expectedOutputScalar,
    labelScalar: null,
    categoryScalar: null,
    indexValues: Object.keys(indexValues).length > 0 ? indexValues : null,
  };
}
