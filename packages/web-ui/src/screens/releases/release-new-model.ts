import {
  deriveClassificationOptionsFromPromptOutputSchema,
  extractClassificationOptionsFromText,
  type CreateProductionReleaseInputDto,
  type PromptOutputSchemaDto,
} from '@proofhound/shared';

export function extractRecordCategoryValues(raw: string): string[] {
  return extractClassificationOptionsFromText(raw);
}

export function deriveRecordCategoryOptions(schema: PromptOutputSchemaDto): string[] {
  return deriveClassificationOptionsFromPromptOutputSchema(schema);
}

export function releaseRecordModeFromCategories(
  selected: string[],
  all: string[],
): CreateProductionReleaseInputDto['recordMode'] {
  if (all.length === 0 || selected.length === all.length) return 'all';
  return 'selected_categories';
}
