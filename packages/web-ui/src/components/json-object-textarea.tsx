'use client';

import { useId, useState, type ChangeEvent, type FocusEvent } from 'react';
import { applyEdits, format, parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { useI18n } from '../i18n';
import { cn } from '@proofhound/ui';

type JsonObjectTextareaProps = {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  onAutoFormat?: () => void;
};

type JsonObjectValidation =
  | { status: 'empty' }
  | { status: 'valid' }
  | { status: 'invalid'; detail: string }
  | { status: 'notObject' };

const JSON_PARSE_OPTIONS = {
  allowTrailingComma: false,
  disallowComments: true,
} as const;

const JSON_FORMAT_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
  eol: '\n',
} as const;

function validateJsonObjectInput(raw: string): JsonObjectValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { status: 'empty' };

  const errors: ParseError[] = [];
  const parsed = parse(trimmed, errors, JSON_PARSE_OPTIONS) as unknown;

  if (errors.length > 0) {
    const firstError = errors[0]!;
    return {
      status: 'invalid',
      detail: `${printParseErrorCode(firstError.error)} ${formatOffset(trimmed, firstError.offset)}`,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'notObject' };
  }

  return { status: 'valid' };
}

function formatJsonObjectInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const validation = validateJsonObjectInput(trimmed);
  if (validation.status !== 'valid') return null;

  return applyEdits(trimmed, format(trimmed, undefined, JSON_FORMAT_OPTIONS));
}

function formatOffset(text: string, offset: number): string {
  const lines = text.slice(0, offset).split(/\r\n|\r|\n/u);
  const line = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;
  return `L${line}:C${column}`;
}

export function JsonObjectTextarea({
  name,
  defaultValue,
  placeholder,
  readOnly = false,
  className,
  onAutoFormat,
}: JsonObjectTextareaProps) {
  const { t } = useI18n();
  const validationId = useId();
  const [validation, setValidation] = useState<JsonObjectValidation>(() => validateJsonObjectInput(defaultValue ?? ''));
  const isInvalid = validation.status === 'invalid' || validation.status === 'notObject';

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setValidation(validateJsonObjectInput(event.currentTarget.value));
  };

  const handleBlur = (event: FocusEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;

    const formatted = formatJsonObjectInput(event.currentTarget.value);
    if (formatted === null) {
      setValidation(validateJsonObjectInput(event.currentTarget.value));
      return;
    }

    if (formatted === event.currentTarget.value) {
      setValidation({ status: formatted ? 'valid' : 'empty' });
      return;
    }

    event.currentTarget.value = formatted;
    setValidation({ status: formatted ? 'valid' : 'empty' });
    onAutoFormat?.();
  };

  const validationMessage =
    validation.status === 'valid'
      ? t('common.jsonInput.validObject')
      : validation.status === 'notObject'
        ? t('common.jsonInput.objectRequired')
        : validation.status === 'invalid'
          ? t('common.jsonInput.invalid').replace('{detail}', validation.detail)
          : '';

  return (
    <div>
      <textarea
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        readOnly={readOnly}
        spellCheck={false}
        aria-describedby={validationMessage ? validationId : undefined}
        aria-invalid={isInvalid || undefined}
        onChange={handleChange}
        onBlur={handleBlur}
        className={cn(
          'min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2',
          isInvalid && 'border-destructive focus:ring-destructive/30',
          readOnly && 'bg-muted/50 text-muted-foreground',
          className,
        )}
      />
      {validationMessage && !readOnly && (
        <div
          id={validationId}
          role={isInvalid ? 'alert' : 'status'}
          className={cn('mt-1.5 text-[11.5px] leading-relaxed', isInvalid ? 'text-destructive' : 'text-muted-foreground')}
        >
          {validationMessage}
        </div>
      )}
    </div>
  );
}
