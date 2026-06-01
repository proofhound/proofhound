import type { RunResultDatasetFieldValueDto, RunResultListItemDto } from '@proofhound/shared';

export interface VariableDisplay {
  name: string;
  value: string;
  rawValue: unknown;
  kind: 'text' | 'image';
  imageSrc?: string;
}

export interface PromptMessageDisplay {
  role: string;
  content: unknown;
}

const IMAGE_KEY_RE =
  /(^|[_-])(image|img|photo|picture|screenshot|thumbnail|receipt_image|image_url|image_base64)([_-]|$)/i;
const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseJsonString(value: string | null | undefined): unknown | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function formatHumanValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.trim() || '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value.map((item) => formatHumanValue(item)).join(', ');
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '—';
    return entries.map(([key, item]) => `${key}: ${formatHumanValue(item)}`).join(' · ');
  }
  return String(value);
}

export function compactHumanValue(value: unknown, maxLength = 120): string {
  const formatted = formatHumanValue(value).replace(/\s+/g, ' ').trim();
  if (formatted.length <= maxLength) return formatted;
  return `${formatted.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function getImageSrc(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('data:image/')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}

function isImageVariable(name: string, value: unknown): boolean {
  const normalizedName = name.toLowerCase();
  if (IMAGE_KEY_RE.test(normalizedName)) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.startsWith('data:image/') || IMAGE_URL_RE.test(trimmed);
  }
  if (isRecord(value)) {
    return Object.entries(value).some(([key, item]) => isImageVariable(key, item));
  }
  return false;
}

export function getVariableDisplays(inputVariables: unknown): VariableDisplay[] {
  if (!isRecord(inputVariables)) return [];
  return Object.entries(inputVariables).map(([name, rawValue]) => {
    const kind = isImageVariable(name, rawValue) ? 'image' : 'text';
    return {
      name,
      rawValue,
      kind,
      value: compactHumanValue(rawValue, kind === 'image' ? 80 : 160),
      imageSrc: kind === 'image' ? getImageSrc(rawValue) : undefined,
    };
  });
}

export function splitVariableDisplays(inputVariables: unknown) {
  const variables = getVariableDisplays(inputVariables);
  return {
    text: variables.filter((item) => item.kind === 'text'),
    image: variables.filter((item) => item.kind === 'image'),
  };
}

export function datasetFieldDisplays(
  fields: RunResultDatasetFieldValueDto[] | null | undefined,
  kind: VariableDisplay['kind'],
): VariableDisplay[] {
  if (!fields) return [];
  return fields.map((field) => ({
    name: field.name,
    rawValue: field.value,
    kind,
    value: compactHumanValue(field.value, kind === 'image' ? 80 : 160),
    imageSrc: kind === 'image' ? getImageSrc(field.value) : undefined,
  }));
}

export function getModelOutputValue(
  runResult: Pick<RunResultListItemDto, 'parsedOutput' | 'rawResponse' | 'decisionOutput' | 'errorMessage'>,
): unknown {
  return (
    runResult.parsedOutput ??
    parseJsonString(runResult.rawResponse) ??
    runResult.rawResponse ??
    runResult.decisionOutput ??
    runResult.errorMessage ??
    null
  );
}

export function hasStructuredModelOutput(
  runResult: Pick<RunResultListItemDto, 'parsedOutput'>,
): boolean {
  return isRecord(runResult.parsedOutput);
}

export function getModelOutputFieldValue(
  runResult: Pick<RunResultListItemDto, 'parsedOutput'>,
  key: string,
): unknown {
  return isRecord(runResult.parsedOutput) ? runResult.parsedOutput[key] : undefined;
}

export function getRenderedPromptMessages(value: unknown): PromptMessageDisplay[] {
  if (!isRecord(value) || !Array.isArray(value['messages'])) return [];
  return value['messages'].filter(isRecord).map((message) => ({
    role: formatHumanValue(message['role']),
    content: message['content'] ?? null,
  }));
}
