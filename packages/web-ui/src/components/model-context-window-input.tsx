'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { ClipboardList, Loader2 } from 'lucide-react';
import { Button, Input, cn } from '@proofhound/ui';
import { useLookupModelContextWindow } from '../hooks';
import { useI18n } from '../i18n';
type LookupStatus = 'idle' | 'applied' | 'missing' | 'needsModelId' | 'failed';

type ModelContextWindowInputProps = {
  defaultValue?: string;
  readOnly?: boolean;
  name?: string;
  providerModelInputName?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  onValueChange?: (value: string) => void;
  testId?: string;
};

function findProviderModelInput(form: HTMLFormElement | null, inputName: string) {
  const selector = `input[name="${inputName}"]`;
  return (form?.querySelector<HTMLInputElement>(selector) ?? document.querySelector<HTMLInputElement>(selector))?.value.trim() ?? '';
}

export function ModelContextWindowInput({
  defaultValue,
  readOnly = false,
  name = 'contextWindowTokens',
  providerModelInputName = 'providerModelId',
  placeholder = '128000',
  className,
  inputClassName,
  buttonClassName,
  onValueChange,
  testId,
}: ModelContextWindowInputProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(defaultValue ?? '');
  const [lookupStatus, setLookupStatus] = useState<LookupStatus>('idle');
  const lookupMutation = useLookupModelContextWindow();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep uncontrolled form defaults in sync after async model load
    setValue(defaultValue ?? '');
  }, [defaultValue]);

  const lookupContextWindow = (event: MouseEvent<HTMLButtonElement>) => {
    const providerModelId = findProviderModelInput(event.currentTarget.form, providerModelInputName);
    if (!providerModelId) {
      setLookupStatus('needsModelId');
      return;
    }

    lookupMutation.mutate(providerModelId, {
      onSuccess: (result) => {
        if (!result) {
          setLookupStatus('missing');
          return;
        }
        const nextValue = String(result.contextWindowTokens);
        setValue(nextValue);
        setLookupStatus('applied');
        onValueChange?.(nextValue);
      },
      onError: () => setLookupStatus('failed'),
    });
  };

  const statusMessage =
    lookupStatus === 'applied'
      ? `${t('models.form.contextDictionaryApplied')}${value} tokens`
      : lookupStatus === 'missing'
        ? t('models.form.contextDictionaryMissing')
        : lookupStatus === 'needsModelId'
          ? t('models.form.contextDictionaryNeedsModelId')
          : lookupStatus === 'failed'
            ? t('models.form.contextDictionaryFailed')
            : null;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            name={name}
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value;
              setValue(nextValue);
              setLookupStatus('idle');
              onValueChange?.(nextValue);
            }}
            inputMode="numeric"
            className={cn('pr-20', readOnly && 'bg-muted/50 text-muted-foreground', inputClassName)}
            placeholder={placeholder}
            readOnly={readOnly}
            data-testid={testId}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            tokens
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          className={cn('shrink-0', buttonClassName)}
          disabled={readOnly || lookupMutation.isPending}
          onClick={lookupContextWindow}
        >
          {lookupMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardList className="size-4" />}
          {lookupMutation.isPending ? t('models.form.contextDictionaryPending') : t('models.form.chooseFromDictionary')}
        </Button>
      </div>
      {statusMessage && (
        <div
          aria-live="polite"
          className={cn(
            'text-[11.5px] leading-relaxed',
            lookupStatus === 'applied' ? 'text-[var(--status-running-fg)]' : 'text-destructive',
          )}
        >
          {statusMessage}
        </div>
      )}
    </div>
  );
}
