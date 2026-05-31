import {
  composeFullPrompt,
  DEFAULT_PROMPT_LANGUAGE,
  outputSchemaToJsonSchema,
  type PromptLanguageDto,
  type PromptOutputSchemaDto,
  type PromptOutputSchemaFieldDto,
} from '@proofhound/shared';

type PromptPreviewOutputField = Pick<PromptOutputSchemaFieldDto, 'key' | 'value' | 'isJudgment'>;

export function composePromptPreview({
  body,
  outputSchema,
  outputFields,
  promptLanguage,
}: {
  body: string;
  outputSchema?: PromptOutputSchemaDto | null;
  outputFields?: ReadonlyArray<PromptPreviewOutputField>;
  promptLanguage?: PromptLanguageDto | null;
}): string {
  const normalizedOutputSchema =
    outputSchema ??
    (outputFields
      ? {
          fields: outputFields.map((field) => ({
            key: field.key,
            value: field.value,
            isJudgment: field.isJudgment,
          })),
        }
      : undefined);
  const jsonSchema = outputSchemaToJsonSchema(normalizedOutputSchema);
  return composeFullPrompt(body, jsonSchema, { language: promptLanguage ?? DEFAULT_PROMPT_LANGUAGE });
}
