'use client';

import type { ReactNode } from 'react';
import { Hash, Image as ImageIcon, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

export type ModalityKind = 'text' | 'image' | 'number';

export const MODALITY_KIND_ORDER: Record<ModalityKind, number> = {
  text: 0,
  image: 1,
  number: 2,
};

export function sortModalityKinds(kinds: ReadonlyArray<ModalityKind>): ModalityKind[] {
  return Array.from(new Set(kinds)).sort((a, b) => MODALITY_KIND_ORDER[a] - MODALITY_KIND_ORDER[b]);
}

const KIND_ICON: Record<ModalityKind, LucideIcon> = {
  text: Type,
  image: ImageIcon,
  number: Hash,
};

const KIND_TOKEN_CLASSES: Record<ModalityKind, string> = {
  text: 'border-[var(--modality-text-bd)] bg-[var(--modality-text-bg)] text-[var(--modality-text-fg)]',
  image: 'border-[var(--modality-image-bd)] bg-[var(--modality-image-bg)] text-[var(--modality-image-fg)]',
  number: 'border-[var(--modality-number-bd)] bg-[var(--modality-number-bg)] text-[var(--modality-number-fg)]',
};

const SIZE_CLASSES: Record<'sm' | 'md', { box: string; icon: string }> = {
  sm: { box: 'size-5', icon: 'size-3' },
  md: { box: 'size-6', icon: 'size-3.5' },
};

export interface ModalityIconProps {
  kind: ModalityKind;
  supported?: boolean;
  tooltip?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

export function ModalityIcon({
  kind,
  supported = true,
  tooltip,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: ModalityIconProps) {
  const Icon = KIND_ICON[kind];
  const sizing = SIZE_CLASSES[size];
  const tone = supported
    ? KIND_TOKEN_CLASSES[kind]
    : 'border-border bg-muted text-muted-foreground opacity-40';

  const badge = (
    <span
      data-testid="modality-icon"
      data-kind={kind}
      data-supported={supported ? 'true' : 'false'}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border',
        sizing.box,
        tone,
        className,
      )}
    >
      <Icon className={sizing.icon} />
    </span>
  );

  if (!tooltip) return badge;

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface ModalityIconGroupProps {
  kinds: ModalityKind[];
  tooltips?: Partial<Record<ModalityKind, ReactNode>>;
  ariaLabels?: Partial<Record<ModalityKind, string>>;
  size?: 'sm' | 'md';
  className?: string;
}

export function ModalityIconGroup({
  kinds,
  tooltips,
  ariaLabels,
  size,
  className,
}: ModalityIconGroupProps) {
  if (kinds.length === 0) return null;
  const ordered = sortModalityKinds(kinds);

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {ordered.map((kind) => (
        <ModalityIcon
          key={kind}
          kind={kind}
          size={size}
          tooltip={tooltips?.[kind]}
          aria-label={ariaLabels?.[kind]}
        />
      ))}
    </span>
  );
}
