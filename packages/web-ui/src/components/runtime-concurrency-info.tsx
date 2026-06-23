'use client';

import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@proofhound/ui';
import { useI18n } from '../i18n';
import { positiveRuntimeLimit, useRuntimeLimits } from '../providers/runtime-limits-provider';

function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function RuntimeConcurrencyInfoIcon() {
  const { t } = useI18n();
  const planLimit = positiveRuntimeLimit(useRuntimeLimits().concurrency?.max);
  if (planLimit === null) return null;

  const title = formatTemplate(t('runtimeLimits.concurrencyInfoTitle'), { limit: planLimit });
  return (
    <TooltipProvider delayDuration={140}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('runtimeLimits.concurrencyInfoLabel')}
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[320px] text-left">
          <div className="text-[11.5px] font-semibold">{title}</div>
          <p className="mt-1 text-[11.5px] leading-relaxed">
            {formatTemplate(t('runtimeLimits.concurrencyInfoDescription'), { limit: planLimit })}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function RuntimeConcurrencyPlanSuffix() {
  const { t } = useI18n();
  const planLimit = positiveRuntimeLimit(useRuntimeLimits().concurrency?.max);
  if (planLimit === null) return null;
  return <>{formatTemplate(t('runtimeLimits.concurrencyPlanSuffix'), { limit: planLimit })}</>;
}
