'use client';

import { Lock, Pencil } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PromptVersionStatusDto } from '@proofhound/shared';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@proofhound/ui';
import { useI18n, type TranslationKey } from '../i18n';
type PromptVersionStatus = PromptVersionStatusDto;

const STATUS_LABEL_KEYS: Record<PromptVersionStatus, TranslationKey> = {
  editable: 'prompts.status.editable',
  frozen: 'prompts.status.frozen',
};

const STATUS_CLASSES: Record<PromptVersionStatus, { pill: string; icon: string }> = {
  editable: {
    pill: 'border-[var(--prompt-editable-bd)] bg-[var(--prompt-editable-bg)] text-[var(--prompt-editable-fg)]',
    icon: 'text-[var(--prompt-editable-icon)]',
  },
  frozen: {
    pill: 'border-[var(--prompt-frozen-bd)] bg-[var(--prompt-frozen-bg)] text-[var(--prompt-frozen-fg)]',
    icon: 'text-[var(--prompt-frozen-icon)]',
  },
};

const STATUS_ICONS = {
  editable: Pencil,
  frozen: Lock,
} satisfies Record<PromptVersionStatus, LucideIcon>;

export function PromptVersionStatusBadge({
  status,
  compact = false,
}: {
  status: PromptVersionStatus;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const classes = STATUS_CLASSES[status];
  const Icon = STATUS_ICONS[status];
  const label = t(STATUS_LABEL_KEYS[status]);

  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full border',
              compact ? 'size-5' : 'size-6',
              classes.pill,
            )}
            aria-label={label}
            role="img"
          >
            <Icon className={cn(compact ? 'size-3' : 'size-3.5', classes.icon)} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
