'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  MODEL_DEFAULT_CONCURRENCY_LIMIT,
  MODEL_MAX_CONCURRENCY_LIMIT,
  MODEL_UNLIMITED_RATE_LIMIT,
  type CreateProjectModelDto,
  type ModelReferencesDto,
  type ProbeModelResponseDto,
  type UpdateProjectModelDto,
} from '@proofhound/shared';
import {
  AlertTriangle,
  Cable,
  Check,
  Copy,
  CopyPlus,
  DollarSign,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { JsonObjectTextarea } from '@/components/json-object-textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Main } from '@/components/layout/main';
import { DetailPageSkeleton } from '@/components/ui/detail-page-skeleton';
import { Progress, formatProgressLabel } from '@/components/ui/progress';
import { ModelContextWindowInput } from '@/components/model-context-window-input';
import { ModelProbeStatus, type ModelProbeFeedback } from '@/components/model-probe-status';
import { ModelPresetQuickFill } from '@/features/model-quick-fill/model-preset-quick-fill';
import type { ModelQuickFillDraft } from '@/features/model-quick-fill/model-preset-draft';
import { useI18n } from '@/i18n';
import { getApiErrorMessage } from '@/lib/api-error';
import { toIntegerInputValue } from '@/lib/model-number';
import { buildProviderTypeOptions } from '@/lib/model-provider-type';
import { isProjectNameTaken } from '@/lib/project-name';
import { cn } from '@/lib/utils';
import {
  useCreateProjectModel,
  useProbeProjectModel,
  useProbeDraftProjectModel,
  useDeleteProjectModel,
  useProjectModels,
  useProjectModel,
  useProjectModelReferences,
  useRevealProjectModelApiKey,
  useUpdateProjectModel,
} from '@/hooks/model';
import type { TranslationKey } from '@/i18n';
import { dtoToProjectModel } from './project-model-adapter';
import {
  getProjectModelSource,
  isProjectModelEditable,
  type ImageCapability,
  type ModelSource,
  type ProjectModel,
} from './model-view-model';
import { MODEL_SOURCE_LABEL_KEYS, MODEL_STATUS_CLASSES, MODEL_STATUS_LABEL_KEYS } from './model-view-model';

const EMPTY_MODEL_REFERENCES: ModelReferencesDto = {
  experiments: 0,
  canaryReleases: 0,
  optimizations: 0,
  productionReleases: 0,
  total: 0,
};

const MODEL_REFERENCE_LABEL_KEYS = {
  experiments: 'models.activeUsage.experiments',
  canaryReleases: 'models.activeUsage.canaryReleases',
  optimizations: 'models.activeUsage.optimizations',
  productionReleases: 'models.activeUsage.productionReleases',
} satisfies Record<keyof Omit<ModelReferencesDto, 'total'>, TranslationKey>;

const PROJECT_MODEL_FALLBACK: ProjectModel = {
  id: '',
  name: '',
  provider: '',
  providerModelId: '',
  endpoint: '',
  source: 'local',
  status: 'enabled',
  apiKey: '',
  credentialTail: '',
  contextWindow: '',
  contextWindowInput: '',
  extraBodyInput: '',
  rpm: { limit: '', limitInput: '', usage: 0, current: '' },
  tpm: { limit: '', limitInput: '', usage: 0, current: '' },
  concurrency: { limit: '', limitInput: '', usage: 0, current: '' },
  autoConcurrency: true,
  pricing: { inputPerMillion: '', outputPerMillion: '' },
  imageCapability: 'none',
  references: 0,
  readonly: false,
  lastUpdated: '',
};

type FormMode = 'new' | 'edit';
type NewModelSubmitIntent = 'draft' | 'enable';
type DraftProbeRecord = Pick<ProbeModelResponseDto, 'status' | 'probedAt' | 'error'> & { signature: string };

function projectModelForCopy(source: ProjectModel, nameSuffix: string): ProjectModel {
  return {
    ...PROJECT_MODEL_FALLBACK,
    name: `${source.name}${nameSuffix}`,
    provider: source.provider,
    providerModelId: source.providerModelId,
    endpoint: source.endpoint,
    contextWindow: source.contextWindow,
    contextWindowInput: source.contextWindowInput,
    extraBodyInput: source.extraBodyInput,
    rpm: { ...PROJECT_MODEL_FALLBACK.rpm, limit: source.rpm.limit, limitInput: source.rpm.limitInput },
    tpm: { ...PROJECT_MODEL_FALLBACK.tpm, limit: source.tpm.limit, limitInput: source.tpm.limitInput },
    concurrency: {
      ...PROJECT_MODEL_FALLBACK.concurrency,
      limit: source.concurrency.limit,
      limitInput: source.concurrency.limitInput,
    },
    pricing: source.pricing,
    imageCapability: source.imageCapability,
  };
}

function projectModelFromQuickFillDraft(draft: ModelQuickFillDraft): ProjectModel {
  return {
    ...PROJECT_MODEL_FALLBACK,
    name: draft.name,
    provider: draft.providerType,
    providerModelId: draft.providerModelId,
    endpoint: draft.endpoint,
    contextWindow: String(draft.contextWindowTokens),
    contextWindowInput: String(draft.contextWindowTokens),
    extraBodyInput: draft.extraBodyInput,
    rpm: {
      ...PROJECT_MODEL_FALLBACK.rpm,
      limit: String(draft.rpmLimit),
      limitInput: String(draft.rpmLimit),
    },
    tpm: {
      ...PROJECT_MODEL_FALLBACK.tpm,
      limit: String(draft.tpmLimit),
      limitInput: String(draft.tpmLimit),
    },
    concurrency: {
      ...PROJECT_MODEL_FALLBACK.concurrency,
      limit: String(draft.concurrencyLimit),
      limitInput: String(draft.concurrencyLimit),
    },
    pricing: {
      inputPerMillion: String(draft.inputTokenPricePerMillion),
      outputPerMillion: String(draft.outputTokenPricePerMillion),
    },
    imageCapability: draft.imageCapability,
  };
}

const SOURCE_CLASS_NAMES: Record<ModelSource, string> = {
  local: 'status-running',
};

function FieldInput({
  name,
  defaultValue,
  suffix,
  placeholder,
  disabled = false,
  readOnly = false,
  type = 'text',
  onChange,
  testId,
}: {
  name?: string;
  defaultValue?: string;
  suffix?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  type?: string;
  onChange?: (value: string) => void;
  testId?: string;
}) {
  return (
    <div className="relative">
      <Input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        data-testid={testId}
        className={cn('h-9 text-sm', suffix && 'pr-20', readOnly && 'bg-muted/50 text-muted-foreground')}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  help,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <div className="mt-1.5 text-[11.5px] leading-relaxed text-destructive">{error}</div>
      ) : (
        help && <div className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">{help}</div>
      )}
    </div>
  );
}

function Section({
  number,
  title,
  right,
  children,
  complete = false,
}: {
  number: string;
  title: string;
  right?: ReactNode;
  children: ReactNode;
  complete?: boolean;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span
          className={cn(
            'inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-semibold text-muted-foreground',
            complete && 'bg-[var(--status-running-dot)] text-white',
          )}
        >
          {number}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

function SwitchLike({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'relative inline-flex h-5 w-9 rounded-full border transition-colors',
        on ? 'border-primary bg-primary' : 'border-border bg-muted',
      )}
      aria-hidden="true"
    >
      <span
        className={cn(
          'absolute top-0.5 size-4 rounded-full bg-card shadow transition-transform',
          on ? 'translate-x-[17px]' : 'translate-x-0.5',
        )}
      />
    </span>
  );
}

function SourceAndStatus({ model }: { model: ProjectModel }) {
  const { t } = useI18n();
  const status = MODEL_STATUS_CLASSES[model.status];

  return (
    <>
      <span
        className={cn(
          'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium',
          SOURCE_CLASS_NAMES[getProjectModelSource(model)],
        )}
      >
        {t(MODEL_SOURCE_LABEL_KEYS[getProjectModelSource(model)])}
      </span>
      <span
        className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', status.pill)}
      >
        <span className={cn('size-1.5 rounded-full', status.dot)} />
        {t(MODEL_STATUS_LABEL_KEYS[model.status])}
      </span>
    </>
  );
}

function BasicSection({
  mode,
  useDefaults,
  model,
  readOnly,
  nameError,
  onNameChange,
  onDraftChange,
}: {
  mode: FormMode;
  useDefaults: boolean;
  model: ProjectModel;
  readOnly: boolean;
  nameError?: string | null;
  onNameChange?: (value: string) => void;
  onDraftChange?: () => void;
}) {
  const { t } = useI18n();
  const isNew = mode === 'new';

  return (
    <Section
      number="1"
      title={t('models.form.basicInfo')}
      complete={isNew}
      right={
        !isNew && (
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {t('models.form.unchanged')}
          </span>
        )
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('models.form.name')} required error={nameError}>
          <FieldInput
            name="name"
            defaultValue={useDefaults ? model.name : undefined}
            placeholder="openai-prod"
            readOnly={readOnly}
            onChange={onNameChange}
            testId={isNew ? 'model-new-name' : undefined}
          />
        </Field>
        <Field
          label={t('models.form.provider')}
          required
          help={!isNew ? t('models.form.providerLockedHelp') : undefined}
        >
          <Select
            name="providerType"
            defaultValue={useDefaults ? model.provider || undefined : undefined}
            disabled={!isNew}
            onValueChange={onDraftChange}
          >
            <SelectTrigger
              className="h-9"
              aria-label={t('models.form.provider')}
              data-testid={isNew ? 'model-new-provider-type' : undefined}
            >
              <SelectValue placeholder={t('models.form.providerPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {buildProviderTypeOptions(useDefaults ? model.provider : undefined).map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  data-testid={isNew ? `model-new-provider-option-${option.value}` : undefined}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('models.form.modelId')} required help={isNew ? t('models.form.modelIdHelp') : undefined}>
          <FieldInput
            name="providerModelId"
            defaultValue={useDefaults ? model.providerModelId : undefined}
            placeholder="gpt-4o-2024-08-06"
            readOnly={readOnly}
            testId={isNew ? 'model-new-provider-model-id' : undefined}
          />
        </Field>
        <Field label={t('models.form.endpoint')} required={isNew}>
          <FieldInput
            name="endpoint"
            defaultValue={useDefaults ? model.endpoint : undefined}
            placeholder="https://api.openai.com/v1"
            readOnly={readOnly}
            testId={isNew ? 'model-new-endpoint' : undefined}
          />
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('models.form.contextWindow')} required>
          <ModelContextWindowInput
            defaultValue={
              useDefaults ? (model.contextWindowInput ?? toIntegerInputValue(model.contextWindow)) : undefined
            }
            readOnly={readOnly}
            inputClassName="h-9 text-sm"
            buttonClassName="h-9"
            onValueChange={onDraftChange}
            testId={isNew ? 'model-new-context-window' : undefined}
          />
        </Field>
      </div>
    </Section>
  );
}

function CredentialSection({
  mode,
  useDefaults,
  model,
  readOnly,
  projectId,
  initialApiKey,
  onApiKeyEdited,
  onDraftChange,
}: {
  mode: FormMode;
  useDefaults: boolean;
  model: ProjectModel;
  readOnly: boolean;
  projectId: string;
  initialApiKey?: string;
  onApiKeyEdited?: () => void;
  onDraftChange?: () => void;
}) {
  const { t } = useI18n();
  const isNew = mode === 'new';
  const revealMutation = useRevealProjectModelApiKey(projectId);
  const [apiKeyVisible, setApiKeyVisible] = useState(isNew);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState(() => initialApiKey ?? (isNew ? '' : model.apiKey));

  const copyApiKey = async () => {
    if (!apiKeyVisible || !apiKeyValue) return;

    await navigator.clipboard?.writeText(apiKeyValue);
    setApiKeyCopied(true);
    window.setTimeout(() => setApiKeyCopied(false), 1800);
  };

  const toggleReveal = () => {
    if (isNew) {
      setApiKeyVisible((visible) => !visible);
      return;
    }
    if (apiKeyVisible) {
      setApiKeyVisible(false);
      return;
    }
    if (apiKeyValue) {
      setApiKeyVisible(true);
      return;
    }
    if (!model.id) return;
    revealMutation.mutate(model.id, {
      onSuccess: (result) => {
        setApiKeyValue(result.apiKey);
        setApiKeyVisible(true);
      },
    });
  };

  return (
    <Section
      number="2"
      title={t('models.form.credential')}
      complete={isNew}
      right={
        <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <Lock className="size-3" />
          {apiKeyVisible
            ? t('models.form.plaintextVisible')
            : isNew
              ? t('models.form.encryptedStorage')
              : t('models.form.masked')}
        </span>
      }
    >
      <Field label="API Key" required={isNew} help={t('models.form.apiKeyHelp')}>
        <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
          <input
            name="apiKey"
            type={apiKeyVisible ? 'text' : 'password'}
            value={apiKeyValue}
            onChange={(event) => {
              setApiKeyValue(event.target.value);
              if (!isNew) onApiKeyEdited?.();
            }}
            readOnly={readOnly}
            placeholder="sk-..."
            data-testid={isNew ? 'model-new-api-key' : undefined}
            className={cn(
              'min-w-0 flex-1 bg-transparent font-mono outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed',
              readOnly && 'text-muted-foreground',
            )}
          />
          {apiKeyVisible && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs"
              aria-label={t('models.form.copyKey')}
              disabled={!apiKeyValue}
              onClick={() => {
                void copyApiKey();
              }}
            >
              <Copy className="size-3.5" />
              {apiKeyCopied ? t('models.form.keyCopied') : t('models.form.copyKey')}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn('size-7', !apiKeyVisible && 'ml-auto')}
            aria-label={t('models.form.revealKey')}
            onClick={toggleReveal}
            disabled={revealMutation.isPending}
          >
            {apiKeyVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
        </div>
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('models.form.extraHeaders')} help={t('models.form.extraHeadersHelp')}>
          <FieldInput placeholder='{ "X-Region": "cn-east" }' readOnly={readOnly} />
        </Field>
        <Field label={t('models.form.extraBody')} help={t('models.form.extraBodyHelp')}>
          <JsonObjectTextarea
            name="extraBody"
            defaultValue={useDefaults ? model.extraBodyInput : undefined}
            placeholder='{ "top_k": 40, "repetition_penalty": 1.05 }'
            readOnly={readOnly}
            onAutoFormat={onDraftChange}
          />
        </Field>
      </div>
    </Section>
  );
}

function capabilityToDraft(model: ProjectModel, useDefaults: boolean) {
  if (!useDefaults) {
    return { supportsImages: true, imageUrl: true, imageBase64: true };
  }
  return {
    supportsImages: model.imageCapability !== 'none',
    imageUrl: model.imageCapability === 'url' || model.imageCapability === 'both',
    imageBase64: model.imageCapability === 'base64' || model.imageCapability === 'both',
  };
}

function imageCapabilityFromDraft(supportsImages: boolean, imageUrl: boolean, imageBase64: boolean): ImageCapability {
  if (!supportsImages) return 'none';
  if (imageUrl && imageBase64) return 'both';
  if (imageUrl) return 'url';
  if (imageBase64) return 'base64';
  return 'none';
}

function CapabilitiesSection({
  mode,
  useDefaults,
  model,
  readOnly,
  onDraftChange,
}: {
  mode: FormMode;
  useDefaults: boolean;
  model: ProjectModel;
  readOnly: boolean;
  onDraftChange?: () => void;
}) {
  const { t } = useI18n();
  const isNew = mode === 'new';
  const initialDraft = useMemo(() => capabilityToDraft(model, useDefaults), [useDefaults, model]);
  const [supportsImages, setSupportsImages] = useState(initialDraft.supportsImages);
  const [imageUrl, setImageUrl] = useState(initialDraft.imageUrl);
  const [imageBase64, setImageBase64] = useState(initialDraft.imageBase64);
  const imageCapability = imageCapabilityFromDraft(supportsImages, imageUrl, imageBase64);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async model detail seeds the controlled capability draft
    setSupportsImages(initialDraft.supportsImages);
    setImageUrl(initialDraft.imageUrl);
    setImageBase64(initialDraft.imageBase64);
  }, [initialDraft]);

  const scheduleDraftChange = () => {
    window.requestAnimationFrame(() => onDraftChange?.());
  };

  const toggleSupportsImages = () => {
    if (readOnly) return;
    setSupportsImages((current) => {
      const next = !current;
      if (next && !imageUrl && !imageBase64) {
        setImageUrl(true);
        setImageBase64(true);
      }
      return next;
    });
    scheduleDraftChange();
  };

  return (
    <Section
      number="3"
      title={t('models.form.capabilities')}
      right={
        !isNew && (
          <span className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium status-pending">
            <AlertTriangle className="size-3" />
            {t('models.form.affectsPrompts')}
          </span>
        )
      }
    >
      <input type="hidden" name="imageCapability" value={imageCapability} />
      <div className="flex items-start justify-between gap-4 py-1">
        <div>
          <div className="text-sm font-medium">{t('models.form.supportsImages')}</div>
          {!isNew && (
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">{t('models.form.supportsImagesHelp')}</div>
          )}
        </div>
        <button
          type="button"
          aria-label={t('models.form.supportsImages')}
          disabled={readOnly}
          onClick={toggleSupportsImages}
        >
          <SwitchLike on={supportsImages} />
        </button>
      </div>
      {supportsImages && (
        <div className="grid gap-3 border-t pt-4 md:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3 hover:bg-accent">
            <input
              name="imageUrl"
              type="checkbox"
              checked={imageUrl}
              disabled={readOnly}
              onChange={(event) => {
                setImageUrl(event.target.checked);
                scheduleDraftChange();
              }}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="block text-xs font-medium">{t('models.form.imageUrl')}</span>
              <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{t('models.form.imageUrlHelp')}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3 hover:bg-accent">
            <input
              name="imageBase64"
              type="checkbox"
              checked={imageBase64}
              disabled={readOnly}
              onChange={(event) => {
                setImageBase64(event.target.checked);
                scheduleDraftChange();
              }}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="block text-xs font-medium">{t('models.form.imageBase64')}</span>
              <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                {t('models.form.imageBase64Help')}
              </span>
            </span>
          </label>
        </div>
      )}
    </Section>
  );
}

function QuotaSection({
  mode,
  useDefaults,
  model,
  readOnly,
}: {
  mode: FormMode;
  useDefaults: boolean;
  model: ProjectModel;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const isEdit = mode === 'edit';
  const isNew = mode === 'new';
  const [autoConcurrency, setAutoConcurrency] = useState(useDefaults ? model.autoConcurrency : true);
  const usageSummary = `${t('models.form.realtimeUsage')}: ${model.rpm.usage}% / ${model.tpm.usage}% / ${model.concurrency.usage}%`;

  return (
    <Section
      number="4"
      title={t('models.form.quotas')}
      right={
        isEdit && (
          <span className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium status-canary">
            <span className="size-1.5 rounded-full dot-canary" />
            {usageSummary}
          </span>
        )
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Field label={t('models.form.rpmLimit')} required help={t('models.form.rpmTpmLimitHelp')}>
          <FieldInput
            name="rpmLimit"
            defaultValue={useDefaults ? (model.rpm.limitInput ?? toIntegerInputValue(model.rpm.limit)) : undefined}
            placeholder="2000"
            suffix="req/min"
            readOnly={readOnly}
            testId={isNew ? 'model-new-rpm-limit' : undefined}
          />
          {isEdit && <QuotaLine usage={model.rpm.usage} current={model.rpm.current} limit={model.rpm.limit} />}
        </Field>
        <Field label={t('models.form.tpmLimit')} required help={t('models.form.rpmTpmLimitHelp')}>
          <FieldInput
            name="tpmLimit"
            defaultValue={useDefaults ? (model.tpm.limitInput ?? toIntegerInputValue(model.tpm.limit)) : undefined}
            placeholder="800000"
            suffix="tok/min"
            readOnly={readOnly}
            testId={isNew ? 'model-new-tpm-limit' : undefined}
          />
          {isEdit && <QuotaLine usage={model.tpm.usage} current={model.tpm.current} limit={model.tpm.limit} />}
        </Field>
        <Field
          label={autoConcurrency ? t('models.form.concurrencyCeiling') : t('models.form.concurrencyLimit')}
          help={autoConcurrency ? t('models.form.autoConcurrencyHelp') : t('models.form.concurrencyLimitHelp')}
        >
          <FieldInput
            name="concurrencyLimit"
            defaultValue={
              useDefaults ? (model.concurrency.limitInput ?? toIntegerInputValue(model.concurrency.limit)) : undefined
            }
            placeholder={String(MODEL_DEFAULT_CONCURRENCY_LIMIT)}
            suffix="in-flight"
            readOnly={readOnly}
          />
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11.5px] text-muted-foreground">
            <input
              name="autoConcurrency"
              type="checkbox"
              checked={autoConcurrency}
              disabled={readOnly}
              onChange={(event) => setAutoConcurrency(event.target.checked)}
              className="size-3.5 accent-primary"
            />
            <span>{t('models.form.autoConcurrency')}</span>
          </label>
          {isEdit && (
            <QuotaLine
              usage={model.concurrency.usage}
              current={model.concurrency.current}
              limit={
                autoConcurrency && model.concurrency.effective
                  ? `${model.concurrency.effective} / ${model.concurrency.limit}`
                  : model.concurrency.limit
              }
            />
          )}
        </Field>
      </div>
    </Section>
  );
}

function QuotaLine({ usage, current, limit }: { usage: number; current: string; limit: string }) {
  const meterLabel = formatProgressLabel({
    value: usage,
    max: 100,
    percent: usage,
    valueLabel: current,
    maxLabel: limit,
  });

  return (
    <>
      <Progress value={usage} label={meterLabel} className="mt-2" />
    </>
  );
}

function PricingSection({
  useDefaults,
  model,
  readOnly,
}: {
  useDefaults: boolean;
  model: ProjectModel;
  readOnly: boolean;
}) {
  const { t } = useI18n();

  return (
    <Section
      number="5"
      title={t('models.form.pricing')}
      right={
        <span className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium status-canary">
          <DollarSign className="size-3" />
          {t('models.form.costEstimateBasis')}
        </span>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('models.form.inputTokenPrice')} required help={t('models.form.inputTokenPriceHelp')}>
          <FieldInput
            name="inputPrice"
            type="number"
            defaultValue={useDefaults ? model.pricing.inputPerMillion : undefined}
            placeholder="2.50"
            suffix="/ 1M tokens"
            readOnly={readOnly}
          />
        </Field>
        <Field label={t('models.form.outputTokenPrice')} required help={t('models.form.outputTokenPriceHelp')}>
          <FieldInput
            name="outputPrice"
            type="number"
            defaultValue={useDefaults ? model.pricing.outputPerMillion : undefined}
            placeholder="10.00"
            suffix="/ 1M tokens"
            readOnly={readOnly}
          />
        </Field>
      </div>
      <div className="rounded-md border bg-muted/45 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {t('models.form.costFormula')}
      </div>
    </Section>
  );
}

function draftImageCapability(form: FormData): ImageCapability {
  const imageUrl = form.has('imageUrl');
  const imageBase64 = form.has('imageBase64');
  if (imageUrl && imageBase64) return 'both';
  if (imageUrl) return 'url';
  if (imageBase64) return 'base64';
  return 'none';
}

function positiveIntegerFromForm(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').trim();
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function rateLimitFromForm(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').trim();
  const value = Number(raw);
  return Number.isInteger(value) && (value === MODEL_UNLIMITED_RATE_LIMIT || value > 0) ? value : null;
}

function concurrencyLimitFromForm(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').trim();
  const value = raw ? Number(raw) : MODEL_DEFAULT_CONCURRENCY_LIMIT;
  return Number.isInteger(value) && value > 0 && value <= MODEL_MAX_CONCURRENCY_LIMIT ? value : null;
}

function nonnegativeNumberFromForm(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').trim();
  const value = Number(raw || '0');
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function textFromForm(form: FormData, key: string) {
  return String(form.get(key) ?? '').trim();
}

function normalizedNumberSignature(raw: string | undefined) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : trimmed;
}

function normalizedJsonSignature(raw: string | undefined) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : trimmed;
  } catch {
    return trimmed;
  }
}

function jsonObjectFromForm(form: FormData, key: string): Record<string, unknown> | null {
  const raw = String(form.get(key) ?? '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function projectEditSignatureFromModel(model: ProjectModel) {
  return JSON.stringify({
    name: model.name.trim(),
    providerModelId: model.providerModelId.trim(),
    endpoint: model.endpoint.trim(),
    apiKey: '',
    contextWindowTokens: normalizedNumberSignature(
      model.contextWindowInput ?? toIntegerInputValue(model.contextWindow),
    ),
    rpmLimit: normalizedNumberSignature(model.rpm.limitInput ?? toIntegerInputValue(model.rpm.limit)),
    tpmLimit: normalizedNumberSignature(model.tpm.limitInput ?? toIntegerInputValue(model.tpm.limit)),
    concurrencyLimit: normalizedNumberSignature(
      model.concurrency.limitInput ?? toIntegerInputValue(model.concurrency.limit),
    ),
    autoConcurrency: model.autoConcurrency,
    inputPrice: normalizedNumberSignature(model.pricing.inputPerMillion),
    outputPrice: normalizedNumberSignature(model.pricing.outputPerMillion),
    imageCapability: model.imageCapability,
    extraBody: normalizedJsonSignature(model.extraBodyInput),
  });
}

function projectEditSignatureFromForm(form: HTMLFormElement, apiKeyEdited: boolean) {
  const data = new FormData(form);
  return JSON.stringify({
    name: textFromForm(data, 'name'),
    providerModelId: textFromForm(data, 'providerModelId'),
    endpoint: textFromForm(data, 'endpoint'),
    apiKey: apiKeyEdited ? textFromForm(data, 'apiKey') : '',
    contextWindowTokens: normalizedNumberSignature(String(data.get('contextWindowTokens') ?? '')),
    rpmLimit: normalizedNumberSignature(String(data.get('rpmLimit') ?? '')),
    tpmLimit: normalizedNumberSignature(String(data.get('tpmLimit') ?? '')),
    concurrencyLimit: normalizedNumberSignature(String(data.get('concurrencyLimit') ?? '')),
    autoConcurrency: data.has('autoConcurrency'),
    inputPrice: normalizedNumberSignature(String(data.get('inputPrice') ?? '')),
    outputPrice: normalizedNumberSignature(String(data.get('outputPrice') ?? '')),
    imageCapability: String(data.get('imageCapability') ?? 'none'),
    extraBody: normalizedJsonSignature(String(data.get('extraBody') ?? '')),
  });
}

function readProjectModelCreatePayload(
  form: HTMLFormElement,
  intent: NewModelSubmitIntent,
): { ok: true; body: CreateProjectModelDto } | { ok: false; error: 'required' | 'number' | 'json' } {
  const data = new FormData(form);
  const name = textFromForm(data, 'name');
  const providerType = textFromForm(data, 'providerType');
  const providerModelId = textFromForm(data, 'providerModelId');
  const endpoint = textFromForm(data, 'endpoint');
  const apiKey = textFromForm(data, 'apiKey');
  const contextWindowTokens = positiveIntegerFromForm(data, 'contextWindowTokens');
  const rpmLimit = rateLimitFromForm(data, 'rpmLimit');
  const tpmLimit = rateLimitFromForm(data, 'tpmLimit');
  const concurrencyLimit = concurrencyLimitFromForm(data, 'concurrencyLimit');
  const inputPrice = nonnegativeNumberFromForm(data, 'inputPrice');
  const outputPrice = nonnegativeNumberFromForm(data, 'outputPrice');
  const extraBody = jsonObjectFromForm(data, 'extraBody');
  const imageCapability = draftImageCapability(data);

  if ([name, providerType, providerModelId, endpoint, apiKey].some((value) => !value.trim())) {
    return { ok: false, error: 'required' };
  }
  if (extraBody === null) {
    return { ok: false, error: 'json' };
  }
  if (
    contextWindowTokens === null ||
    rpmLimit === null ||
    tpmLimit === null ||
    concurrencyLimit === null ||
    inputPrice === null ||
    outputPrice === null
  ) {
    return { ok: false, error: 'number' };
  }

  return {
    ok: true,
    body: {
      name,
      providerType,
      providerModelId,
      endpoint,
      apiKey,
      contextWindowTokens,
      rpm: { limit: rpmLimit },
      tpm: { limit: tpmLimit },
      concurrency: { limit: concurrencyLimit },
      autoConcurrency: data.has('autoConcurrency'),
      pricing: { inputPerMillion: inputPrice, outputPerMillion: outputPrice },
      capabilities: { image: imageCapability },
      extraBody,
      status: intent === 'draft' ? 'disabled' : 'enabled',
    },
  };
}

function projectModelCreateConnectivitySignature(body: CreateProjectModelDto) {
  return JSON.stringify({
    name: body.name.trim(),
    providerType: body.providerType.trim(),
    providerModelId: body.providerModelId.trim(),
    endpoint: body.endpoint.trim(),
    apiKey: body.apiKey,
    contextWindowTokens: body.contextWindowTokens ?? null,
    rpmLimit: body.rpm.limit,
    tpmLimit: body.tpm.limit,
    concurrencyLimit: body.concurrency.limit,
    inputPrice: body.pricing.inputPerMillion,
    outputPrice: body.pricing.outputPerMillion,
    imageCapability: body.capabilities.image,
    extraBody: body.extraBody ?? {},
  });
}

function readProjectModelUpdatePayload(
  form: HTMLFormElement,
  includeApiKey: boolean,
): { ok: true; body: UpdateProjectModelDto } | { ok: false; error: 'required' | 'number' | 'json' } {
  const data = new FormData(form);
  const name = textFromForm(data, 'name');
  const providerModelId = textFromForm(data, 'providerModelId');
  const endpoint = textFromForm(data, 'endpoint');
  const apiKey = textFromForm(data, 'apiKey');
  const contextWindowTokens = positiveIntegerFromForm(data, 'contextWindowTokens');
  const rpmLimit = rateLimitFromForm(data, 'rpmLimit');
  const tpmLimit = rateLimitFromForm(data, 'tpmLimit');
  const concurrencyLimit = concurrencyLimitFromForm(data, 'concurrencyLimit');
  const inputPrice = nonnegativeNumberFromForm(data, 'inputPrice');
  const outputPrice = nonnegativeNumberFromForm(data, 'outputPrice');
  const extraBody = jsonObjectFromForm(data, 'extraBody');
  const imageCapabilityValue = String(data.get('imageCapability') ?? 'none');
  const imageCapability: ImageCapability =
    imageCapabilityValue === 'url' ||
    imageCapabilityValue === 'base64' ||
    imageCapabilityValue === 'both' ||
    imageCapabilityValue === 'none'
      ? imageCapabilityValue
      : 'none';

  if ([name, providerModelId, endpoint].some((value) => !value.trim())) {
    return { ok: false, error: 'required' };
  }
  if (extraBody === null) {
    return { ok: false, error: 'json' };
  }
  if (
    contextWindowTokens === null ||
    rpmLimit === null ||
    tpmLimit === null ||
    concurrencyLimit === null ||
    inputPrice === null ||
    outputPrice === null
  ) {
    return { ok: false, error: 'number' };
  }

  const body: UpdateProjectModelDto = {
    name,
    providerModelId,
    endpoint,
    contextWindowTokens,
    rpm: { limit: rpmLimit },
    tpm: { limit: tpmLimit },
    concurrency: { limit: concurrencyLimit },
    autoConcurrency: data.has('autoConcurrency'),
    pricing: { inputPerMillion: inputPrice, outputPerMillion: outputPrice },
    capabilities: { image: imageCapability },
    extraBody,
  };
  if (includeApiKey && apiKey) {
    body.apiKey = apiKey;
  }

  return { ok: true, body };
}

function TestConnectivitySection({
  feedback,
  isTesting,
  onTest,
}: {
  feedback: ModelProbeFeedback | null;
  isTesting: boolean;
  onTest: () => void;
}) {
  const { t } = useI18n();

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="inline-flex size-6 items-center justify-center rounded-full border border-[var(--status-canary-bd)] bg-[var(--status-canary-bg)] text-[var(--status-canary-fg)]">
          <Cable className="size-3" />
        </span>
        <h2 className="text-sm font-semibold">{t('models.form.testConnectivity')}</h2>
      </div>
      <div className="space-y-3 p-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={onTest}
          disabled={isTesting}
          aria-busy={isTesting}
        >
          {isTesting ? <Loader2 className="size-3.5 animate-spin" /> : <Cable className="size-3.5" />}
          {isTesting ? t('models.probe.running') : t('models.form.testMinimalRequest')}
        </Button>
        <ModelProbeStatus feedback={feedback} />
      </div>
    </section>
  );
}

function UsagePanel({ model }: { model: ProjectModel }) {
  const { t } = useI18n();
  const meters = [
    { key: 'rpm', label: 'RPM', current: model.rpm.current, limit: model.rpm.limit, usage: model.rpm.usage },
    { key: 'tpm', label: 'TPM', current: model.tpm.current, limit: model.tpm.limit, usage: model.tpm.usage },
    {
      key: 'concurrency',
      label: t('models.table.concurrency'),
      current: model.concurrency.current,
      limit: model.concurrency.limit,
      usage: model.concurrency.usage,
    },
  ];
  const maxUsage = meters.reduce((max, meter) => Math.max(max, isUnlimitedLimit(meter.limit) ? 0 : meter.usage), 0);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Gauge className="size-4 text-[var(--status-canary-fg)]" />
        <h3 className="text-sm font-semibold">{t('models.form.usagePanel')}</h3>
        <span className={cn('ml-auto rounded border px-2 py-0.5 font-mono text-[11px]', usageBadgeClassName(maxUsage))}>
          {t('models.form.usageMaxCapacity')} {maxUsage}%
        </span>
      </div>
      <div className="divide-y p-4">
        {meters.map((meter) => (
          <UsageGauge
            key={meter.key}
            label={meter.label}
            current={meter.current}
            limit={meter.limit}
            usage={meter.usage}
          />
        ))}
      </div>
    </div>
  );
}

function UsageGauge({
  label,
  current,
  limit,
  usage,
}: {
  label: string;
  current: string;
  limit: string;
  usage: number;
}) {
  const { t } = useI18n();
  const unlimited = isUnlimitedLimit(limit);
  const boundedUsage = Math.max(0, Math.min(100, Math.round(usage)));
  const tone = usageTone(boundedUsage, unlimited);
  const capacityLabel = unlimited ? t('models.form.usageUnlimited') : `${boundedUsage}%`;

  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div
        className="relative h-[72px] w-24"
        aria-label={`${label} ${t('models.form.usageCapacity')} ${capacityLabel}`}
      >
        <svg viewBox="0 0 120 78" className="h-full w-full overflow-visible" role="img">
          <path
            d="M 14 64 A 46 46 0 0 1 106 64"
            fill="none"
            stroke="var(--border)"
            strokeLinecap="round"
            strokeWidth="12"
          />
          <path
            d="M 14 64 A 46 46 0 0 1 106 64"
            fill="none"
            pathLength={100}
            stroke={tone.stroke}
            strokeDasharray={unlimited ? '4 8' : `${boundedUsage} 100`}
            strokeLinecap="round"
            strokeWidth="12"
          />
        </svg>
        <div className="absolute inset-x-0 bottom-1 text-center">
          <div className="font-mono text-lg font-semibold leading-none" style={{ color: tone.text }}>
            {capacityLabel}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
            {t('models.form.usageCapacity')}
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[11px] font-semibold uppercase text-foreground">{label}</div>
          <span
            className={cn(
              'rounded border px-1.5 py-0.5 font-mono text-[10.5px]',
              usageBadgeClassName(boundedUsage, unlimited),
            )}
          >
            {capacityLabel}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <div className="text-[10.5px] text-muted-foreground">{t('models.form.usageCurrent')}</div>
            <div className="truncate font-mono text-base font-semibold leading-tight">{formatUsageNumber(current)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] text-muted-foreground">{t('models.form.usageLimit')}</div>
            <div className="truncate font-mono text-base font-semibold leading-tight">
              {unlimited ? t('models.form.usageUnlimited') : formatUsageNumber(limit)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function isUnlimitedLimit(limit: string) {
  const value = Number(limit);
  return Number.isFinite(value) && value < 0;
}

function formatUsageNumber(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value || '0';
  return new Intl.NumberFormat('en-US').format(numeric);
}

function usageBadgeClassName(usage: number, unlimited = false) {
  if (unlimited)
    return 'border-[var(--status-archived-bd)] bg-[var(--status-archived-bg)] text-[var(--status-archived-fg)]';
  if (usage >= 90) return 'border-destructive/30 bg-destructive/10 text-destructive';
  if (usage >= 80)
    return 'border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]';
  return 'border-[var(--status-canary-bd)] bg-[var(--status-canary-bg)] text-[var(--status-canary-fg)]';
}

function usageTone(usage: number, unlimited: boolean) {
  if (unlimited) {
    return { stroke: 'var(--status-archived-dot)', text: 'var(--status-archived-fg)' };
  }
  if (usage >= 90) {
    return { stroke: 'var(--destructive)', text: 'var(--destructive)' };
  }
  if (usage >= 80) {
    return { stroke: 'var(--status-pending-dot)', text: 'var(--status-pending-fg)' };
  }
  return { stroke: 'var(--status-canary-dot)', text: 'var(--status-canary-fg)' };
}

function ReferencePanel({ references, loading }: { references: ModelReferencesDto; loading: boolean }) {
  const { t } = useI18n();
  const items = (Object.keys(MODEL_REFERENCE_LABEL_KEYS) as Array<keyof Omit<ModelReferencesDto, 'total'>>).map(
    (key) => ({
      key,
      label: t(MODEL_REFERENCE_LABEL_KEYS[key]),
      count: references[key],
    }),
  );

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Link2 className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t('models.form.referencedBy')}</h3>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {loading ? t('common.loading') : `${t('models.form.activeReferences')} ${references.total}`}
        </span>
      </div>
      <div className="p-4">
        {references.total === 0 && !loading ? (
          <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
            {t('models.form.noActiveReferences')}
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.key}
              className="-mx-4 flex items-center justify-between gap-2 border-b px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 text-xs font-medium">{item.label}</div>
              <div className="font-mono text-[11px] text-muted-foreground">{item.count}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReadonlyNotice() {
  const { t } = useI18n();

  return (
    <div className="rounded-lg border border-[var(--status-canary-bd)] bg-[var(--status-canary-bg)] p-4 text-[var(--status-canary-fg)]">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{t('models.form.readonlyTitle')}</div>
          <div className="mt-1 text-[12.5px] leading-relaxed">{t('models.form.readonlyDescription')}</div>
        </div>
      </div>
    </div>
  );
}

function DangerPanel({
  model,
  references,
  pending,
  disabled,
  onToggleStatus,
  onDelete,
}: {
  model: ProjectModel;
  references: ModelReferencesDto;
  pending: boolean;
  disabled: boolean;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const statusLabel = model.status === 'disabled' ? t('models.action.enable') : t('models.action.disable');

  return (
    <div className="rounded-lg border border-destructive/40 bg-card">
      <div className="flex items-center gap-2 border-b border-destructive/30 px-4 py-3 text-destructive">
        <AlertTriangle className="size-4" />
        <h3 className="text-sm font-semibold">{t('models.form.dangerZone')}</h3>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium">{t('models.form.disableTemporarily')}</div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">{t('models.form.disableHelp')}</div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={disabled || pending}
            onClick={onToggleStatus}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {statusLabel}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <div>
            <div className="text-xs font-medium">{t('models.action.delete')}</div>
            <div className="mt-0.5 text-[11.5px] text-destructive">
              {references.total > 0 ? t('models.form.deleteBlockedHelp') : t('models.deleteDialogDescription')}
            </div>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-8"
            disabled={disabled || pending}
            onClick={onDelete}
          >
            {t('models.action.delete')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ModelFormPage({
  mode,
  projectId,
  modelId,
  copyFromId,
}: {
  mode: FormMode;
  projectId: string;
  modelId?: string;
  copyFromId?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const isNew = mode === 'new';
  const modelQuery = useProjectModel(projectId, isNew ? '' : (modelId ?? ''));
  const copyQuery = useProjectModel(projectId, isNew ? (copyFromId ?? '') : '');
  const projectModelsQuery = useProjectModels(projectId, { autoRefresh: false });
  const referencesQuery = useProjectModelReferences(
    projectId,
    isNew ? '' : (modelId ?? ''),
    !isNew && Boolean(modelId),
  );
  const probeMutation = useProbeProjectModel(projectId);
  const draftProbeMutation = useProbeDraftProjectModel(projectId);
  const createMutation = useCreateProjectModel(projectId);
  const updateMutation = useUpdateProjectModel(projectId);
  const deleteMutation = useDeleteProjectModel(projectId);
  const newModelFormRef = useRef<HTMLFormElement | null>(null);
  const editModelFormRef = useRef<HTMLFormElement | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [editDraftVersion, setEditDraftVersion] = useState(0);
  const [apiKeyEdited, setApiKeyEdited] = useState(false);
  const [newFormVersion, setNewFormVersion] = useState(0);
  const [newApiKeySeed, setNewApiKeySeed] = useState('');
  const [quickFillDraft, setQuickFillDraft] = useState<ModelQuickFillDraft | null>(null);
  const [newNameDraft, setNewNameDraft] = useState('');
  const [editNameDraft, setEditNameDraft] = useState('');
  const [pendingNewIntent, setPendingNewIntent] = useState<NewModelSubmitIntent | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [probeFeedback, setProbeFeedback] = useState<ModelProbeFeedback | null>(null);
  const [draftProbeFeedback, setDraftProbeFeedback] = useState<ModelProbeFeedback | null>(null);
  const [draftProbeRecord, setDraftProbeRecord] = useState<DraftProbeRecord | null>(null);
  const copySuffix = t('models.copySuffix');
  const copySource = useMemo(
    () =>
      isNew && copyFromId && copyQuery.data ? projectModelForCopy(dtoToProjectModel(copyQuery.data), copySuffix) : null,
    [isNew, copyFromId, copyQuery.data, copySuffix],
  );
  const waitingForCopy = isNew && !!copyFromId && !copySource;
  const fetchedModel = useMemo(() => (modelQuery.data ? dtoToProjectModel(modelQuery.data) : null), [modelQuery.data]);
  const quickFillModel = useMemo(
    () => (isNew && quickFillDraft ? projectModelFromQuickFillDraft(quickFillDraft) : null),
    [isNew, quickFillDraft],
  );
  const projectModels = useMemo(() => projectModelsQuery.data?.data ?? [], [projectModelsQuery.data]);
  const model: ProjectModel = quickFillModel ?? copySource ?? fetchedModel ?? PROJECT_MODEL_FALLBACK;
  const useDefaults = !isNew || !!copySource || !!quickFillModel;
  const liveModel = model;
  const isEditable = isNew || isProjectModelEditable(model);
  const readOnly = !isEditable;
  const references = referencesQuery.data ?? EMPTY_MODEL_REFERENCES;
  const deleteBlocked = references.total > 0;
  const initialEditSignature = useMemo(
    () => (!isNew && model.id ? projectEditSignatureFromModel(model) : ''),
    [isNew, model],
  );
  const nameTakenMessage = t('common.formError.nameTaken');
  const newNameTaken = isNew && isProjectNameTaken(newNameDraft, projectModels);
  const editNameTaken = !isNew && isProjectNameTaken(editNameDraft, projectModels, model.id);
  const activeNameError = newNameTaken || editNameTaken ? nameTakenMessage : null;

  const refreshEditDirty = useCallback(() => {
    if (isNew || !editModelFormRef.current || !initialEditSignature) return;
    setEditDirty(projectEditSignatureFromForm(editModelFormRef.current, apiKeyEdited) !== initialEditSignature);
  }, [apiKeyEdited, initialEditSignature, isNew]);

  const scheduleEditDirtyRefresh = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(refreshEditDirty);
  }, [refreshEditDirty]);

  const applyQuickFillDraft = useCallback((draft: ModelQuickFillDraft) => {
    const currentApiKey = newModelFormRef.current
      ? String(new FormData(newModelFormRef.current).get('apiKey') ?? '')
      : '';
    setNewApiKeySeed(currentApiKey);
    setQuickFillDraft(draft);
    setSubmitError(null);
    setDraftProbeFeedback(null);
    setDraftProbeRecord(null);
    setNewFormVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!isNew) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- copied / quick-filled model name seeds an uncontrolled form field
    setNewNameDraft(model.name);
  }, [isNew, model.name, newFormVersion]);

  useEffect(() => {
    if (isNew) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loaded model name seeds duplicate-name validation
    setEditNameDraft(model.name);
  }, [editDraftVersion, isNew, model.id, model.name]);

  useEffect(() => {
    if (isNew) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async model detail establishes the clean edit baseline
    setEditDirty(false);
    setApiKeyEdited(false);
  }, [initialEditSignature, isNew]);

  useEffect(() => {
    refreshEditDirty();
  }, [refreshEditDirty]);

  const handleEditSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || !model.id || !editDirty || updateMutation.isPending) return;
    const result = readProjectModelUpdatePayload(event.currentTarget, apiKeyEdited);
    if (!result.ok) {
      setSubmitError(
        result.error === 'required'
          ? t('common.formError.requiredMissing')
          : result.error === 'json'
            ? t('common.formError.invalidJson')
            : t('common.formError.invalidNumber'),
      );
      return;
    }
    if (isProjectNameTaken(result.body.name, projectModels, model.id)) {
      setSubmitError(nameTakenMessage);
      return;
    }
    setSubmitError(null);
    updateMutation.mutate(
      { modelId: model.id, body: result.body },
      {
        onSuccess: () => {
          setEditDirty(false);
          setApiKeyEdited(false);
        },
        onError: (error) => {
          const message = getApiErrorMessage(error);
          setSubmitError(message === 'model_name_taken' ? nameTakenMessage : (message ?? t('common.loadFailedRefresh')));
        },
      },
    );
  };

  const resetEditDraft = () => {
    setSubmitError(null);
    setApiKeyEdited(false);
    setEditDirty(false);
    setEditDraftVersion((version) => version + 1);
  };

  const toggleModelStatus = () => {
    if (!model.id || editDirty || updateMutation.isPending) return;
    const status = model.status === 'disabled' ? 'enabled' : 'disabled';
    updateMutation.mutate(
      { modelId: model.id, body: { status } },
      {
        onError: (error) => setSubmitError((error as Error).message),
      },
    );
  };

  const confirmDeleteModel = () => {
    if (!model.id || deleteBlocked || deleteMutation.isPending) return;
    deleteMutation.mutate(
      { modelId: model.id },
      {
        onSuccess: () => router.push(`/models`),
        onError: (error) => setSubmitError((error as Error).message),
      },
    );
  };

  const testConnectivity = () => {
    if (!model.id) return;
    const startedAt = Date.now();
    setProbeFeedback({ status: 'running', durationMs: null });
    probeMutation.mutate(model.id, {
      onSuccess: (result) => {
        setProbeFeedback({
          status: result.status === 'success' ? 'success' : 'failed',
          durationMs: result.durationMs,
          errorMessage: result.error,
        });
      },
      onError: (error) => {
        setProbeFeedback({
          status: 'failed',
          durationMs: Date.now() - startedAt,
          errorMessage: getApiErrorMessage(error),
        });
      },
    });
  };

  const refreshDraftProbeFreshness = useCallback(() => {
    if (!isNew || !draftProbeRecord || !newModelFormRef.current) return;
    const result = readProjectModelCreatePayload(newModelFormRef.current, 'enable');
    if (!result.ok || projectModelCreateConnectivitySignature(result.body) !== draftProbeRecord.signature) {
      setDraftProbeFeedback(null);
      setDraftProbeRecord(null);
    }
  }, [draftProbeRecord, isNew]);

  const testDraftConnectivity = () => {
    if (!newModelFormRef.current) return;
    const startedAt = Date.now();
    const form = new FormData(newModelFormRef.current);
    const name = textFromForm(form, 'name');
    const providerType = textFromForm(form, 'providerType');
    const providerModelId = textFromForm(form, 'providerModelId');
    const endpoint = textFromForm(form, 'endpoint');
    const apiKey = String(form.get('apiKey') ?? '');
    const contextWindowTokens = positiveIntegerFromForm(form, 'contextWindowTokens');
    const rpmLimit = rateLimitFromForm(form, 'rpmLimit');
    const tpmLimit = rateLimitFromForm(form, 'tpmLimit');
    const concurrencyLimit = concurrencyLimitFromForm(form, 'concurrencyLimit');
    const inputPrice = nonnegativeNumberFromForm(form, 'inputPrice');
    const outputPrice = nonnegativeNumberFromForm(form, 'outputPrice');
    const extraBody = jsonObjectFromForm(form, 'extraBody');
    const imageCapability = draftImageCapability(form);

    setDraftProbeFeedback({ status: 'running', durationMs: null });
    setDraftProbeRecord(null);

    if (
      [name, providerType, providerModelId, endpoint, apiKey].some((value) => !value.trim()) ||
      contextWindowTokens === null ||
      rpmLimit === null ||
      tpmLimit === null ||
      concurrencyLimit === null ||
      inputPrice === null ||
      outputPrice === null
    ) {
      setDraftProbeFeedback({
        status: 'failed',
        durationMs: 0,
        errorMessage: t('common.formError.requiredMissing'),
      });
      return;
    }
    if (extraBody === null) {
      setDraftProbeFeedback({
        status: 'failed',
        durationMs: 0,
        errorMessage: t('common.formError.invalidJson'),
      });
      return;
    }

    const draftBody: CreateProjectModelDto = {
      name,
      providerType,
      providerModelId,
      endpoint,
      apiKey,
      contextWindowTokens,
      rpm: { limit: rpmLimit },
      tpm: { limit: tpmLimit },
      concurrency: { limit: concurrencyLimit },
      autoConcurrency: form.has('autoConcurrency'),
      pricing: { inputPerMillion: inputPrice, outputPerMillion: outputPrice },
      capabilities: { image: imageCapability },
      extraBody,
    };
    const draftSignature = projectModelCreateConnectivitySignature(draftBody);

    draftProbeMutation.mutate(draftBody, {
      onSuccess: (result) => {
        const currentResult = newModelFormRef.current
          ? readProjectModelCreatePayload(newModelFormRef.current, 'enable')
          : null;
        if (!currentResult?.ok || projectModelCreateConnectivitySignature(currentResult.body) !== draftSignature) {
          return;
        }
        setDraftProbeFeedback({
          status: result.status === 'success' ? 'success' : 'failed',
          durationMs: result.durationMs,
          errorMessage: result.error,
        });
        setDraftProbeRecord({
          status: result.status,
          probedAt: result.probedAt,
          error: result.error,
          signature: draftSignature,
        });
      },
      onError: (error) => {
        setDraftProbeRecord(null);
        setDraftProbeFeedback({
          status: 'failed',
          durationMs: Date.now() - startedAt,
          errorMessage: getApiErrorMessage(error),
        });
      },
    });
  };

  const handleNewSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createMutation.isPending || draftProbeMutation.isPending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const intent =
      submitter instanceof HTMLElement && submitter.dataset.modelSubmitIntent === 'draft' ? 'draft' : 'enable';
    const result = readProjectModelCreatePayload(event.currentTarget, intent);
    if (!result.ok) {
      setSubmitError(
        result.error === 'required'
          ? t('common.formError.requiredMissing')
          : result.error === 'json'
            ? t('common.formError.invalidJson')
            : t('common.formError.invalidNumber'),
      );
      return;
    }
    if (isProjectNameTaken(result.body.name, projectModels)) {
      setSubmitError(nameTakenMessage);
      return;
    }
    setSubmitError(null);
    setPendingNewIntent(intent);
    const currentSignature = projectModelCreateConnectivitySignature(result.body);
    const createBody: CreateProjectModelDto =
      draftProbeRecord && draftProbeRecord.signature === currentSignature
        ? {
            ...result.body,
            initialProbe: {
              status: draftProbeRecord.status,
              probedAt: draftProbeRecord.probedAt,
              error: draftProbeRecord.error,
            },
          }
        : result.body;
    createMutation.mutate(createBody, {
      onSuccess: () => router.push(`/models`),
      onError: (error) => {
        const message = getApiErrorMessage(error);
        setSubmitError(message === 'model_name_taken' ? nameTakenMessage : (message ?? t('common.loadFailedRefresh')));
      },
      onSettled: () => setPendingNewIntent(null),
    });
  };

  const headerProbePending = isNew ? draftProbeMutation.isPending : probeMutation.isPending;
  const headerProbeFeedback = isNew ? draftProbeFeedback : probeFeedback;
  const headerProbeDisabled = isNew ? draftProbeMutation.isPending : !model.id || probeMutation.isPending;
  const headerProbeAction = isNew ? testDraftConnectivity : testConnectivity;

  if (waitingForCopy) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-6 sm:px-6 lg:px-8" data-testid="model-new-page">
          <DetailPageSkeleton />
        </div>
      </Main>
    );
  }

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div
        className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-6 sm:px-6 lg:px-8"
        data-testid={isNew ? 'model-new-page' : 'model-edit-page'}
      >
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="mb-1 font-mono text-[11.5px] text-muted-foreground">
              <Link className="hover:text-foreground" href={`/models`}>
                {t('models.title')}
              </Link>
              <span className="px-1.5">/</span>
              <span className="text-foreground">
                {isNew ? t('models.create') : readOnly ? t('models.form.detail') : t('models.form.edit')}
              </span>
            </div>
            <h1 className="text-[26px] font-semibold">{isNew ? t('models.create') : model.name}</h1>
            {!isNew && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <SourceAndStatus model={model} />
                <span className="font-mono text-xs text-muted-foreground">
                  {model.provider} · {model.providerModelId} · {t('models.form.updated')} {model.lastUpdated}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-start gap-2 xl:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm" className="h-9">
                <Link href={`/models`}>{isNew ? t('common.cancel') : t('common.back')}</Link>
              </Button>
              {!isNew && isEditable && model.id && (
                <Button asChild variant="outline" size="sm" className="h-9" title={t('models.action.copyHelp')}>
                  <Link href={`/models/new?copyFrom=${model.id}`} aria-label={t('models.action.copy')}>
                    <CopyPlus className="size-4" />
                    {t('models.action.copy')}
                  </Link>
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={headerProbeAction}
                disabled={headerProbeDisabled}
                aria-busy={headerProbePending}
              >
                {headerProbePending ? <Loader2 className="size-4 animate-spin" /> : <Cable className="size-4" />}
                {headerProbePending ? t('models.probe.running') : t('models.action.test')}
              </Button>
              {isNew ? (
                <>
                  <Button
                    type="submit"
                    form="project-model-new-form"
                    variant="outline"
                    size="sm"
                    className="h-9"
                    data-model-submit-intent="draft"
                    disabled={createMutation.isPending || draftProbeMutation.isPending || newNameTaken}
                    aria-busy={pendingNewIntent === 'draft'}
                  >
                    {pendingNewIntent === 'draft' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    {t('models.form.saveDraft')}
                  </Button>
                  <Button
                    type="submit"
                    form="project-model-new-form"
                    size="sm"
                    className="h-9"
                    data-model-submit-intent="enable"
                    data-testid="model-new-submit"
                    disabled={createMutation.isPending || draftProbeMutation.isPending || newNameTaken}
                    aria-busy={pendingNewIntent === 'enable'}
                  >
                    {pendingNewIntent === 'enable' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    {t('models.form.saveAndEnable')}
                  </Button>
                </>
              ) : isEditable ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9"
                    disabled={editDirty || updateMutation.isPending}
                    onClick={toggleModelStatus}
                  >
                    <KeyRound className="size-4" />
                    {model.status === 'disabled' ? t('models.action.enable') : t('models.action.disable')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-9"
                    disabled={
                      editDirty || referencesQuery.isLoading || updateMutation.isPending || deleteMutation.isPending
                    }
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" />
                    {t('models.action.delete')}
                  </Button>
                </>
              ) : null}
            </div>
            <ModelProbeStatus feedback={headerProbeFeedback} className="w-full xl:w-[380px]" />
          </div>
        </div>

        {isNew ? (
          <form
            key={newFormVersion}
            id="project-model-new-form"
            ref={newModelFormRef}
            onSubmit={handleNewSubmit}
            onInput={refreshDraftProbeFreshness}
            onChange={refreshDraftProbeFreshness}
            className="space-y-4"
          >
            <ModelPresetQuickFill
              selectedKey={quickFillDraft?.key}
              disabled={createMutation.isPending}
              onApply={applyQuickFillDraft}
            />
            {submitError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {submitError}
              </div>
            )}
            <BasicSection
              mode={mode}
              useDefaults={useDefaults}
              model={model}
              readOnly={readOnly}
              nameError={activeNameError}
              onNameChange={setNewNameDraft}
            />
            <CredentialSection
              mode={mode}
              useDefaults={useDefaults}
              model={model}
              readOnly={readOnly}
              projectId={projectId}
              initialApiKey={newApiKeySeed}
            />
            <CapabilitiesSection mode={mode} useDefaults={useDefaults} model={model} readOnly={readOnly} />
            <QuotaSection mode={mode} useDefaults={useDefaults} model={liveModel} readOnly={readOnly} />
            <PricingSection useDefaults={useDefaults} model={model} readOnly={readOnly} />
            <TestConnectivitySection
              feedback={draftProbeFeedback}
              isTesting={draftProbeMutation.isPending}
              onTest={testDraftConnectivity}
            />
          </form>
        ) : (
          <form
            key={`${model.id}-${editDraftVersion}`}
            id="project-model-edit-form"
            ref={editModelFormRef}
            onSubmit={handleEditSubmit}
            onInput={scheduleEditDirtyRefresh}
            onChange={scheduleEditDirtyRefresh}
            className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]"
          >
            <div className="space-y-4">
              {submitError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {submitError}
                </div>
              )}
              {readOnly && <ReadonlyNotice />}
              <BasicSection
                mode={mode}
                useDefaults={useDefaults}
                model={model}
                readOnly={readOnly}
                nameError={activeNameError}
                onNameChange={setEditNameDraft}
                onDraftChange={scheduleEditDirtyRefresh}
              />
              <CredentialSection
                mode={mode}
                useDefaults={useDefaults}
                model={model}
                readOnly={readOnly}
                projectId={projectId}
                onDraftChange={scheduleEditDirtyRefresh}
                onApiKeyEdited={() => {
                  setApiKeyEdited(true);
                  scheduleEditDirtyRefresh();
                }}
              />
              <CapabilitiesSection
                mode={mode}
                useDefaults={useDefaults}
                model={model}
                readOnly={readOnly}
                onDraftChange={scheduleEditDirtyRefresh}
              />
              <QuotaSection mode={mode} useDefaults={useDefaults} model={liveModel} readOnly={readOnly} />
              <PricingSection useDefaults={useDefaults} model={model} readOnly={readOnly} />
            </div>
            <aside className="space-y-4">
              <UsagePanel model={liveModel} />
              <ReferencePanel references={references} loading={referencesQuery.isLoading} />
              {isEditable && (
                <DangerPanel
                  model={model}
                  references={references}
                  pending={updateMutation.isPending || deleteMutation.isPending}
                  disabled={editDirty || referencesQuery.isLoading}
                  onToggleStatus={toggleModelStatus}
                  onDelete={() => setDeleteOpen(true)}
                />
              )}
            </aside>
          </form>
        )}
      </div>

      {isNew && (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 md:left-[var(--sidebar-width)]">
          <div className="mx-auto flex max-w-[1440px] justify-end">
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/models`}>{t('common.cancel')}</Link>
              </Button>
              <Button
                type="submit"
                form="project-model-new-form"
                variant="outline"
                size="sm"
                data-model-submit-intent="draft"
                disabled={createMutation.isPending || draftProbeMutation.isPending || newNameTaken}
                aria-busy={pendingNewIntent === 'draft'}
              >
                {pendingNewIntent === 'draft' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {t('models.form.saveDraft')}
              </Button>
              <Button
                type="submit"
                form="project-model-new-form"
                size="sm"
                data-model-submit-intent="enable"
                disabled={createMutation.isPending || draftProbeMutation.isPending || newNameTaken}
                aria-busy={pendingNewIntent === 'enable'}
              >
                {pendingNewIntent === 'enable' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {t('models.form.saveAndEnable')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {!isNew && isEditable && (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 md:left-[var(--sidebar-width)]">
          <div className="mx-auto flex max-w-[1440px] justify-end">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!editDirty || updateMutation.isPending}
                onClick={resetEditDraft}
              >
                {t('models.form.cancelChanges')}
              </Button>
              <Button
                type="submit"
                form="project-model-edit-form"
                size="sm"
                disabled={!editDirty || updateMutation.isPending || editNameTaken}
                aria-busy={updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {t('models.form.saveChanges')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteBlocked ? t('models.form.deleteBlockedTitle') : t('models.deleteDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {deleteBlocked ? t('models.form.deleteBlockedDescription') : t('models.deleteDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div
              className={cn(
                'rounded-md border p-3 text-sm',
                deleteBlocked ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'bg-muted/45',
              )}
            >
              <div className="text-xs font-medium text-muted-foreground">
                {deleteBlocked ? t('models.form.activeReferences') : t('models.deleteDialogTarget')}
              </div>
              <div className="mt-1 font-medium">{model.name}</div>
              {deleteBlocked && <div className="mt-1 text-xs">{t('models.form.deleteBlockedHelp')}</div>}
            </div>
            {deleteBlocked && (
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(MODEL_REFERENCE_LABEL_KEYS) as Array<keyof Omit<ModelReferencesDto, 'total'>>).map(
                  (key) => (
                    <div key={key} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <span>{t(MODEL_REFERENCE_LABEL_KEYS[key])}</span>
                      <span className="font-mono text-xs">{references[key]}</span>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              <X className="size-4" />
              {deleteBlocked ? t('common.close') : t('common.cancel')}
            </Button>
            {!deleteBlocked && (
              <Button
                type="button"
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={confirmDeleteModel}
              >
                {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('models.deleteDialogConfirm')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Main>
  );
}
