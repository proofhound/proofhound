'use client';

import type { ReactNode } from 'react';
import type { PromptVersionStatusDto } from '@proofhound/shared';
import { ModalityIcon, sortModalityKinds, cn } from '@proofhound/ui';
import type { ModalityKind } from '@proofhound/ui';
import { PromptVersionStatusBadge } from './prompt-version-status-badge';
import { useI18n, type TranslationKey } from '../i18n';
type PickerVariable = {
  type: string;
};

const MODALITY_LABEL_KEYS: Record<ModalityKind, TranslationKey> = {
  text: 'prompts.variableType.text',
  image: 'prompts.variableType.image',
  number: 'prompts.variableType.number',
};

function variableTypeToModality(type: string): ModalityKind {
  if (type === 'image' || type === 'image_url' || type === 'image_base64') return 'image';
  if (type === 'number') return 'number';
  return 'text';
}

function countVariableModalities(variables: ReadonlyArray<PickerVariable>): Partial<Record<ModalityKind, number>> {
  const counts: Partial<Record<ModalityKind, number>> = {};
  for (const variable of variables) {
    const kind = variableTypeToModality(variable.type);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

export function PromptVariableModalityBadges({
  variables,
  size = 'sm',
  className,
}: {
  variables: ReadonlyArray<PickerVariable>;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useI18n();
  const counts = countVariableModalities(variables);
  const kinds = sortModalityKinds(
    (Object.keys(counts) as ModalityKind[]).filter((kind) => typeof counts[kind] === 'number' && counts[kind]! > 0),
  );

  if (kinds.length === 0) return null;

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      {kinds.map((kind) => {
        const label = t(MODALITY_LABEL_KEYS[kind]);
        const count = counts[kind] ?? 0;
        return (
          <span key={kind} className="inline-flex items-center gap-0.5">
            <span className="min-w-2.5 text-right font-mono text-[10.5px] font-semibold text-muted-foreground">
              {count}
            </span>
            <ModalityIcon kind={kind} size={size} tooltip={label} aria-label={`${count} ${label}`} />
          </span>
        );
      })}
    </span>
  );
}

export function PromptVersionPickerTag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'info' | 'positive' | 'warning';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10.5px]',
        tone === 'info' &&
          'border-[var(--status-canary-bd)] bg-[var(--status-canary-bg)] text-[var(--status-canary-fg)]',
        tone === 'positive' &&
          'border-[var(--status-success-bd)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]',
        tone === 'warning' &&
          'border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]',
        tone === 'neutral' && 'border-border bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function PickerRadio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 inline-flex size-4 flex-none items-center justify-center rounded-full border',
        checked ? 'border-primary bg-primary/10' : 'border-border bg-background',
      )}
    >
      {checked ? <span className="size-2 rounded-full bg-primary" /> : null}
    </span>
  );
}

export function PromptVersionPickerRow({
  version,
  status,
  variables,
  selected,
  onSelect,
  badges,
  createdAt,
  trailing,
  className,
}: {
  version: ReactNode;
  status?: PromptVersionStatusDto | null;
  variables: ReadonlyArray<PickerVariable>;
  selected: boolean;
  onSelect: () => void;
  badges?: ReactNode;
  createdAt?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40',
        selected && 'bg-primary/5',
        className,
      )}
    >
      <PickerRadio checked={selected} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold">{version}</span>
          {badges}
          {status ? <PromptVersionStatusBadge status={status} compact /> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <PromptVariableModalityBadges variables={variables} />
          {createdAt ? <span className="font-mono text-[10.5px] text-muted-foreground">{createdAt}</span> : null}
          {trailing}
        </div>
      </div>
    </button>
  );
}
