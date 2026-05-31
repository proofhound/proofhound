'use client';

import { Languages } from 'lucide-react';
import type { PromptLanguageDto } from '@proofhound/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@proofhound/ui';
import { useI18n, type TranslationKey } from '../i18n';
export type PromptLanguage = PromptLanguageDto;

const PROMPT_LANGUAGE_OPTIONS: Array<{ value: PromptLanguage; labelKey: TranslationKey }> = [
  { value: 'zh-CN', labelKey: 'promptLanguage.zhCN' },
  { value: 'en-US', labelKey: 'promptLanguage.enUS' },
];

export function PromptLanguageSelect({
  value,
  onChange,
  disabled = false,
  className,
  triggerClassName,
  labelKey = 'promptLanguage.label',
  helpKey = 'promptLanguage.help',
}: {
  value: PromptLanguage;
  onChange: (value: PromptLanguage) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  labelKey?: TranslationKey;
  helpKey?: TranslationKey;
}) {
  const { t } = useI18n();

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
        <Languages className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span>{t(labelKey)}</span>
      </div>
      <Select value={value} onValueChange={(next) => onChange(next as PromptLanguage)} disabled={disabled}>
        <SelectTrigger className={cn('h-9 text-[12.5px]', triggerClassName)} aria-label={t(labelKey)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROMPT_LANGUAGE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="text-[11px] leading-relaxed text-muted-foreground">{t(helpKey)}</div>
    </div>
  );
}
