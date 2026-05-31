'use client';

import { useState } from 'react';
import { MODEL_PRESET_GROUPS, MODEL_PRESETS, type ModelImageCapability, type ModelPreset } from '@proofhound/shared';
import { Sparkles } from 'lucide-react';
import { QuickFillPicker, type QuickFillPickerOption } from '../../components/quick-fill/quick-fill-picker';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@proofhound/ui';
import { useI18n } from '../../i18n';
import { modelPresetToQuickFillDraft, type ModelQuickFillDraft } from './model-preset-draft';

export function ModelPresetQuickFill({
  selectedKey,
  disabled,
  onApply,
}: {
  selectedKey?: string | null;
  disabled?: boolean;
  onApply: (draft: ModelQuickFillDraft) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const options: Array<QuickFillPickerOption<ModelPreset['group']>> = MODEL_PRESETS.map((preset) => ({
    key: preset.key,
    group: preset.group,
    title: preset.name,
    subtitle: preset.providerModelId,
    description: preset.providerLabel,
    featured: preset.featured,
    badges: [formatTokens(preset.contextWindowTokens), imageCapabilityLabel(preset.capabilities.image, t)],
    meta: [
      `${formatLimit(preset.rpmLimit)} RPM`,
      `${formatLimit(preset.tpmLimit)} TPM`,
      `$${preset.inputTokenPricePerMillion} / $${preset.outputTokenPricePerMillion}`,
    ],
    searchText: `${preset.providerType} ${preset.providerLabel} ${preset.endpoint}`,
  }));
  const presetByKey = new Map(MODEL_PRESETS.map((preset) => [preset.key, preset]));
  const selectedPreset = selectedKey ? presetByKey.get(selectedKey) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-9"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid="model-preset-quick-fill-trigger"
      >
        <Sparkles className="size-4" />
        <span>{t('models.quickFill.title')}</span>
        {selectedPreset && (
          <span className="max-w-[160px] truncate text-muted-foreground">· {selectedPreset.name}</span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
        <DialogContent className="max-h-[86vh] max-w-[1040px] overflow-hidden p-0">
          <DialogHeader className="border-b px-6 pb-4 pt-6 pr-12">
            <DialogTitle>{t('models.quickFill.title')}</DialogTitle>
            <DialogDescription>{t('models.quickFill.description')}</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-6 pb-6 pt-4">
            <QuickFillPicker
              groups={MODEL_PRESET_GROUPS}
              options={options}
              labels={{
                title: t('models.quickFill.title'),
                description: t('models.quickFill.description'),
                searchPlaceholder: t('models.quickFill.searchPlaceholder'),
                featured: t('models.quickFill.featured'),
                all: t('models.quickFill.all'),
                empty: t('models.quickFill.empty'),
                apply: t('models.quickFill.apply'),
                selected: t('models.quickFill.selected'),
                ariaLabel: t('models.quickFill.filterAria'),
              }}
              selectedKey={selectedKey}
              disabled={disabled}
              showHeader={false}
              className="border-0 bg-transparent p-0"
              onApply={(option) => {
                const preset = presetByKey.get(option.key);
                if (!preset) return;
                onApply(modelPresetToQuickFillDraft(preset));
                setOpen(false);
              }}
              testId="model-preset-quick-fill"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M ctx`;
  if (tokens >= 1_000) return `${tokens / 1_000}k ctx`;
  return `${tokens} ctx`;
}

function formatLimit(limit: number): string {
  if (limit < 0) return '∞';
  if (limit >= 1_000_000) return `${limit / 1_000_000}M`;
  if (limit >= 1_000) return `${limit / 1_000}k`;
  return String(limit);
}

function imageCapabilityLabel(capability: ModelImageCapability, t: ReturnType<typeof useI18n>['t']): string {
  if (capability === 'both') return t('models.quickFill.imageBoth');
  if (capability === 'url') return t('models.quickFill.imageUrl');
  if (capability === 'base64') return t('models.quickFill.imageBase64');
  return t('models.quickFill.textOnly');
}
