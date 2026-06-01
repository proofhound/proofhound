'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useI18n } from '../../i18n';
import { cn } from '@proofhound/ui';
import { PROMPT_VARIABLE_TYPE_LABEL_KEYS, type PromptVariable, type PromptVariableType } from './prompt-model';

export { PromptVersionStatusBadge as StatusBadge } from '../../components';

const MODALITY_TOKEN_CLASSES = {
  text: 'border-[var(--modality-text-bd)] bg-[var(--modality-text-bg)] text-[var(--modality-text-fg)]',
  image: 'border-[var(--modality-image-bd)] bg-[var(--modality-image-bg)] text-[var(--modality-image-fg)]',
  number: 'border-[var(--modality-number-bd)] bg-[var(--modality-number-bg)] text-[var(--modality-number-fg)]',
} as const;

export const VARIABLE_TONE_CLASSES: Record<PromptVariableType, string> = {
  text: MODALITY_TOKEN_CLASSES.text,
  image: MODALITY_TOKEN_CLASSES.image,
  image_url: MODALITY_TOKEN_CLASSES.image,
  image_base64: MODALITY_TOKEN_CLASSES.image,
  number: MODALITY_TOKEN_CLASSES.number,
};

export function SelectionBox({
  checked,
  ariaLabel,
  disabled,
  onClick,
}: {
  checked: boolean;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'inline-flex size-4 items-center justify-center rounded-[3px] border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/50 bg-background',
      )}
      aria-label={ariaLabel}
      aria-pressed={checked}
    >
      {checked && <Check className="size-3" />}
    </button>
  );
}

export function VariableToken({
  variable,
  dimmed = false,
  count,
}: {
  variable: PromptVariable;
  dimmed?: boolean;
  count?: number;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[12px] font-medium',
        dimmed ? 'border-border bg-muted/35 text-muted-foreground' : VARIABLE_TONE_CLASSES[variable.type],
      )}
    >
      <span>{`{{${variable.name}}}`}</span>
      {count !== undefined && (
        <span
          className={cn(
            'inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4',
            dimmed ? 'bg-background text-muted-foreground' : 'bg-background/70 text-current',
          )}
        >
          {count}
        </span>
      )}
    </span>
  );
}

export function VariableTypePill({ type }: { type: PromptVariableType }) {
  const { t } = useI18n();

  return (
    <span
      className={cn('inline-flex rounded border px-1.5 py-0.5 font-mono text-[10.5px]', VARIABLE_TONE_CLASSES[type])}
    >
      {t(PROMPT_VARIABLE_TYPE_LABEL_KEYS[type])}
    </span>
  );
}

export function CountPill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold',
        className,
      )}
    >
      {children}
    </span>
  );
}

const IMAGE_PROMPT_VARIABLE_TYPES: ReadonlySet<PromptVariableType> = new Set(['image', 'image_url', 'image_base64']);

export function isImageVariableType(type: PromptVariableType): boolean {
  return IMAGE_PROMPT_VARIABLE_TYPES.has(type);
}

export function uniqVariableTypes(variables: ReadonlyArray<PromptVariable>): PromptVariableType[] {
  return Array.from(new Set(variables.map((variable) => variable.type)));
}

export function hasImageVariable(variables: ReadonlyArray<PromptVariable>): boolean {
  return variables.some((variable) => isImageVariableType(variable.type));
}

export function VariableTypePillGroup({ types, className }: { types: PromptVariableType[]; className?: string }) {
  if (types.length === 0) return null;
  return (
    <span
      className={cn('inline-flex flex-wrap items-center gap-1', className)}
      data-testid="prompt-variable-type-pill-group"
    >
      {types.map((type) => (
        <VariableTypePill key={type} type={type} />
      ))}
    </span>
  );
}
