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

function isCorrectCategory(category: string) {
  return /^(correct|true|pass|yes|正确|通过|是)$/iu.test(category.trim());
}

export function releaseRecordModeFromCategories(
  selected: string[],
  all: string[],
): CreateProductionReleaseInputDto['recordMode'] {
  if (all.length === 0 || selected.length === all.length) return 'all';
  if (selected.length === 1 && isCorrectCategory(selected[0] ?? '')) return 'correct_only';
  return 'all';
}
