'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Copy, Eye, EyeOff, KeyRound, Plus, Save, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  DetailPageSkeleton,
  SlidingViewToggle,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableActionIconButton,
} from '@proofhound/ui';
import type { TableColumn } from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import {
  useConnector,
  useConnectorReferences,
  useConnectorWebhookTokens,
  useCreateConnectorWebhookToken,
  useDeleteConnector,
  usePeekConnector,
  useRevealConnectorWebhookToken,
  useRevokeConnectorWebhookToken,
  useUpdateConnector,
} from '../../hooks';
import { useDateTimeFormatter } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n, type Language, type TranslationKey } from '../../i18n';
import { getApiErrorMessage, isCanonicalUuid } from '../../lib';
import type {
  ConnectorDetailDto,
  ConnectorDirection,
  ConnectorWebhookTokenSummaryDto,
  CreateWebhookTokenResponseDto,
  KafkaConnectionConfig,
  PeekConnectorMessageDto,
  RedisConnectionConfig,
  UpdateConnectorDto,
} from '@proofhound/shared';
import { ConnectorTypeBadge, DirectionBadge } from './connector-ui';

const WEBHOOK_PATH_PREFIX = '/webhooks';
const DEFAULT_WEBHOOK_SLUG = 'webhook';
const REQUEST_FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const;
type RequestFieldType = (typeof REQUEST_FIELD_TYPES)[number];
type TokenExpiryPreset = 'never' | '7d' | '30d' | '90d' | 'custom';
interface LatestPeekConfig {
  lastPeekPayloadSchema?: Record<string, unknown> | null;
  lastPeekMessage?: PeekConnectorMessageDto | null;
  lastPeekedAt?: string;
  lastPeekMessageCount?: number;
}
type ConnectionSource = 'local_config';

const FIELD_COLUMNS: TableColumn[] = [
  { key: 'key', width: 'normal' },
  { key: 'type', width: 'compact' },
  { key: 'description', width: 'flex', minPx: 260 },
  { key: 'actions', width: 'narrow' },
];

const LATEST_SCHEMA_COLUMNS: TableColumn[] = [
  { key: 'key', width: 'normal' },
  { key: 'type', width: 'compact' },
  { key: 'description', width: 'flex', minPx: 260 },
];

const TOKEN_COLUMNS: TableColumn[] = [
  { key: 'name', width: 'normal' },
  { key: 'token', width: 'flex', minPx: 220 },
  { key: 'lastUsedAt', width: 'compact' },
  { key: 'expiresAt', width: 'compact' },
  { key: 'createdAt', width: 'compact' },
  { key: 'actions', width: 'compact', sticky: 'right' },
];

const DEFAULT_WEBHOOK_SCHEMA_ZH = {
  type: 'object',
  properties: {
    request_id: { type: 'string', description: '上游业务请求 ID' },
    text: { type: 'string', description: '需要提示词处理的文本内容' },
    metadata: { type: 'object', description: '业务上下文，可在灰度 / 正式发布中映射为变量' },
  },
};

const DEFAULT_WEBHOOK_SCHEMA_EN = {
  type: 'object',
  properties: {
    request_id: { type: 'string', description: 'Upstream business request ID' },
    text: { type: 'string', description: 'Text content to process with the prompt' },
    metadata: { type: 'object', description: 'Business context for release variable mapping' },
  },
};

interface RequestField {
  key: string;
  type: RequestFieldType;
  description: string;
}

interface DetailFormState {
  name: string;
  description: string;
  connectionSource: ConnectionSource;
  connectionHost: string;
  connectionPort: string;
  connectionUsername: string;
  connectionDefaultDbIndex: string;
  connectionDeploymentType: 'standalone' | 'sentinel' | 'cluster';
  connectionPassword: string;
  connectionBootstrapBrokers: string;
  connectionSecurityProtocol: 'PLAINTEXT' | 'SSL' | 'SASL_PLAINTEXT' | 'SASL_SSL';
  connectionSaslMechanism: '' | 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512';
  connectionSaslUsername: string;
  connectionSaslPassword: string;
  configMode: 'list' | 'stream';
  configKey: string;
  configConsumerGroup: string;
  configMaxLen: string;
  configTopic: string;
  configFromBeginning: boolean;
  configPartitionKey: string;
  ipWhitelistRaw: string;
  webhookMode: 'sync' | 'async';
  webhookTimeoutSeconds: string;
  webhookTargetUrl: string;
  webhookMethod: 'POST' | 'PUT';
  webhookSlug: string;
  webhookPathName: string;
  requestFields: RequestField[];
  // Legacy fields removed: tokenId / token selection is now managed by the per-connector webhook token panel.
}

interface DeleteState {
  open: boolean;
  force: boolean;
  reason: string;
}

interface TokenCreateState {
  open: boolean;
  name: string;
  expiryPreset: TokenExpiryPreset;
  customExpiresAt: string;
}

const EMPTY_DELETE: DeleteState = { open: false, force: false, reason: '' };
const EMPTY_TOKEN_CREATE: TokenCreateState = {
  open: false,
  name: '',
  expiryPreset: 'never',
  customExpiresAt: '',
};

export function ConnectorDetailPage({ projectId, connectorId }: { projectId: string; connectorId: string }) {
  const { t, language } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const defaultWebhookSchema = useMemo(() => getDefaultWebhookSchema(language), [language]);
  const canUseApi = isCanonicalUuid(projectId) && isCanonicalUuid(connectorId);
  const query = useConnector(canUseApi ? projectId : '', canUseApi ? connectorId : '');
  const referencesQuery = useConnectorReferences(projectId, connectorId, canUseApi);
  const isWebhookInput = canUseApi; // hook gate; webhook-only narrowing happens via enabled flag inside body
  const webhookTokensQuery = useConnectorWebhookTokens(
    canUseApi ? projectId : '',
    canUseApi ? connectorId : '',
    isWebhookInput,
  );
  const deleteMutation = useDeleteConnector(projectId);
  const updateMutation = useUpdateConnector(projectId);
  const peekMutation = usePeekConnector(projectId);
  const createTokenMutation = useCreateConnectorWebhookToken(projectId, connectorId);
  const revealTokenMutation = useRevealConnectorWebhookToken(projectId, connectorId);
  const revokeTokenMutation = useRevokeConnectorWebhookToken(projectId, connectorId);
  const connector = query.data ?? null;
  const defaultWebhookSlug = useMemo(
    () => buildDefaultWebhookSlug(connector?.webhookPath ?? connector?.id ?? ''),
    [connector?.id, connector?.webhookPath],
  );

  const [hydratedConnectorId, setHydratedConnectorId] = useState('');
  const [form, setForm] = useState<DetailFormState>(() =>
    connectorToState(null, getDefaultWebhookSchema('zh-CN'), DEFAULT_WEBHOOK_SLUG),
  );
  const [deleteState, setDeleteState] = useState<DeleteState>(EMPTY_DELETE);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedTokenResult, setGeneratedTokenResult] = useState<CreateWebhookTokenResponseDto | null>(null);
  const [revealedTokens, setRevealedTokens] = useState<Record<string, string>>({});
  const [visibleTokenIds, setVisibleTokenIds] = useState<Set<string>>(() => new Set());
  const [tokenCreate, setTokenCreate] = useState<TokenCreateState>(EMPTY_TOKEN_CREATE);
  const [tokenRevokeTarget, setTokenRevokeTarget] = useState<ConnectorWebhookTokenSummaryDto | null>(null);
  const tokenRows = useMemo<ConnectorWebhookTokenSummaryDto[]>(
    () => mergeGeneratedToken(webhookTokensQuery.data?.data ?? [], generatedTokenResult),
    [webhookTokensQuery.data?.data, generatedTokenResult],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- async connector detail seeds the local edit draft once per connector id */
  useEffect(() => {
    if (!connector || connector.id === hydratedConnectorId) return;
    setForm(connectorToState(connector, defaultWebhookSchema, defaultWebhookSlug));
    setGeneratedTokenResult(null);
    setRevealedTokens({});
    setVisibleTokenIds(new Set());
    setTokenCreate(EMPTY_TOKEN_CREATE);
    setTokenRevokeTarget(null);
    setHydratedConnectorId(connector.id);
  }, [connector, defaultWebhookSlug, defaultWebhookSchema, hydratedConnectorId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const webhookApiPath = useMemo(
    () => buildWebhookApiPath(form.webhookSlug, form.webhookPathName),
    [form.webhookPathName, form.webhookSlug],
  );

  const totalRefs = referencesQuery.data?.summary
    ? referencesQuery.data.summary.canaryReleases + referencesQuery.data.summary.productionReleases
    : 0;

  const samplePayload = useMemo(() => buildSamplePayload(form.requestFields, language), [form.requestFields, language]);

  const curlExample = useMemo(() => {
    const tokenLabel =
      generatedTokenResult && visibleTokenIds.has(generatedTokenResult.id)
        ? generatedTokenResult.plaintext
        : '<WEBHOOK_TOKEN>';
    return [
      `curl -X POST "$PROOFHOUND_API_ORIGIN${webhookApiPath}"`,
      `  -H "Authorization: Bearer ${tokenLabel}"`,
      '  -H "Content-Type: application/json"',
      `  -d '${JSON.stringify(samplePayload, null, 2)}'`,
    ].join(' \\\n');
  }, [generatedTokenResult, samplePayload, visibleTokenIds, webhookApiPath]);

  const webhookResponseExample = useMemo(
    () => buildWebhookResponseExample(form.webhookMode, language),
    [form.webhookMode, language],
  );
  const asyncQueryCurlExample = useMemo(() => {
    const tokenLabel =
      generatedTokenResult && visibleTokenIds.has(generatedTokenResult.id)
        ? generatedTokenResult.plaintext
        : '<WEBHOOK_TOKEN>';
    return [
      `curl "$PROOFHOUND_API_ORIGIN${webhookApiPath}/calls/call_20260521_001"`,
      `  -H "Authorization: Bearer ${tokenLabel}"`,
    ].join(' \\\n');
  }, [generatedTokenResult, visibleTokenIds, webhookApiPath]);
  const asyncQueryResponseExample = useMemo(() => buildWebhookAsyncQueryResponseExample(language), [language]);

  const detailLoading = useDelayedLoading(canUseApi && query.isLoading);
  if (detailLoading) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div
          className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8"
          data-testid="project-connector-detail-page"
        >
          <DetailPageSkeleton />
        </div>
      </Main>
    );
  }

  if (!connector) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div
          className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-8"
          data-testid="project-connector-detail-page"
        >
          <div className="rounded-lg border bg-card p-8 text-center">
            <h1 className="text-xl font-semibold">{t('common.notFound')}</h1>
            <Button asChild className="mt-4">
              <Link href={`/connectors`}>{t('connectors.title')}</Link>
            </Button>
          </div>
        </div>
      </Main>
    );
  }

  function update<K extends keyof DetailFormState>(key: K, value: DetailFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateConnection<K extends keyof DetailFormState>(key: K, value: DetailFormState[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      connectionSource: 'local_config',
    }));
  }

  function updateRequestField(index: number, patch: Partial<RequestField>) {
    setForm((prev) => ({
      ...prev,
      requestFields: prev.requestFields.map((field, currentIndex) =>
        currentIndex === index ? { ...field, ...patch } : field,
      ),
    }));
  }

  function addRequestField() {
    setForm((prev) => ({
      ...prev,
      requestFields: [...prev.requestFields, { key: '', type: 'string', description: '' }],
    }));
  }

  function removeRequestField(index: number) {
    setForm((prev) => ({
      ...prev,
      requestFields:
        prev.requestFields.length > 1
          ? prev.requestFields.filter((_field, currentIndex) => currentIndex !== index)
          : prev.requestFields,
    }));
  }

  async function copyText(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2200);
  }

  async function saveConnector(options?: { silent?: boolean }) {
    setError(null);
    if (!connector) return null;
    try {
      const body = buildUpdatePayload(connector, form);
      const updated = await updateMutation.mutateAsync({ connectorId: connector.id, body });
      if (!options?.silent) {
        setNotice(t('connectors.detail.saveSuccess'));
        window.setTimeout(() => setNotice(null), 2200);
      }
      return updated;
    } catch (err) {
      setError(getApiErrorMessage(err) ?? t('connectors.detail.saveFailed'));
      return null;
    }
  }

  async function runQueueProbe() {
    const updated = await saveConnector({ silent: true });
    if (!updated) return;
    try {
      const result = await peekMutation.mutateAsync({ connectorId: updated.id, body: { limit: 1 } });
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice(t('connectors.peek.saved'));
      window.setTimeout(() => setNotice(null), 2200);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? t('connectors.peek.failed'));
    }
  }

  function openTokenCreateDialog() {
    if (!connector) return;
    setTokenCreate({
      open: true,
      name: buildGeneratedTokenName(connector.name),
      expiryPreset: 'never',
      customExpiresAt: '',
    });
  }

  function closeTokenCreateDialog() {
    setTokenCreate(EMPTY_TOKEN_CREATE);
  }

  async function submitCreateToken() {
    setError(null);
    if (!connector || connector.type !== 'webhook' || connector.direction !== 'input') return;
    const name = tokenCreate.name.trim();
    if (name.length < 2) {
      setError(t('connectors.token.nameRequired'));
      return;
    }
    const expiresAt = resolveTokenExpiresAt(tokenCreate);
    if (expiresAt === 'invalid') {
      setError(t('connectors.token.invalidExpiresAt'));
      return;
    }
    try {
      // CreateWebhookTokenDto only accepts name / expiresAt; the IP whitelist goes through the connector update path,
      // no longer carried on the token row. See createWebhookTokenSchema in packages/shared/src/dto/connector.dto.ts.
      const created = await createTokenMutation.mutateAsync({
        name,
        ...(expiresAt ? { expiresAt } : {}),
      });
      setGeneratedTokenResult(created);
      // By default, optimistically stuff the just-created token plaintext into the cache and display it once, so the user can copy it immediately.
      setRevealedTokens((prev) => ({ ...prev, [created.id]: created.plaintext }));
      setVisibleTokenIds((prev) => {
        const next = new Set(prev);
        next.add(created.id);
        return next;
      });
      closeTokenCreateDialog();
      setNotice(t('connectors.token.created'));
      window.setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? t('connectors.token.createFailed'));
    }
  }

  async function toggleTokenPlaintext(token: ConnectorWebhookTokenSummaryDto) {
    setError(null);
    if (visibleTokenIds.has(token.id)) {
      setVisibleTokenIds((prev) => {
        const next = new Set(prev);
        next.delete(token.id);
        return next;
      });
      return;
    }

    if (revealedTokens[token.id]) {
      setVisibleTokenIds((prev) => new Set(prev).add(token.id));
      return;
    }

    try {
      const result = await revealTokenMutation.mutateAsync(token.id);
      if (!result.available || !result.plaintext) {
        setError(t('connectors.token.revealUnavailable'));
        return;
      }
      setRevealedTokens((prev) => ({ ...prev, [token.id]: result.plaintext! }));
      setVisibleTokenIds((prev) => new Set(prev).add(token.id));
    } catch (err) {
      setError(getApiErrorMessage(err) ?? t('connectors.token.revealFailed'));
    }
  }

  async function submitRevokeToken() {
    if (!tokenRevokeTarget) return;
    setError(null);
    const targetId = tokenRevokeTarget.id;
    try {
      await revokeTokenMutation.mutateAsync(targetId);
      setGeneratedTokenResult((prev) => (prev?.id === targetId ? null : prev));
      setRevealedTokens((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      setVisibleTokenIds((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
      setTokenRevokeTarget(null);
      setNotice(t('connectors.token.deleted'));
      window.setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? t('connectors.token.deleteFailed'));
    }
  }

  async function submitDelete() {
    try {
      await deleteMutation.mutateAsync({
        connectorId,
        options: deleteState.force ? { force: true, reason: deleteState.reason.trim() } : undefined,
      });
      window.location.href = `/connectors`;
    } catch (err) {
      setError(getApiErrorMessage(err) ?? t('connectors.delete.confirmTitle'));
    }
  }

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div
        className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8"
        data-testid="project-connector-detail-page"
      >
        <div className="mb-4">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/connectors`}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              {t('connectors.title')}
            </Link>
          </Button>
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveConnector();
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{connector.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t('connectors.detail.subtitle')}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <DirectionBadge direction={connector.direction} />
                <ConnectorTypeBadge type={connector.type} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={updateMutation.isPending} data-testid="project-connector-save-button">
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? t('connectors.form.submitting') : t('connectors.form.submit')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeleteState({ open: true, force: totalRefs > 0, reason: '' })}
                data-testid="project-connector-delete-button"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('connectors.action.delete')}
              </Button>
            </div>
          </div>

          {notice && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{notice}</div>
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Section title={t('connectors.section.basic')}>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <Field label={t('connectors.form.name')} required>
                <Input value={form.name} onChange={(event) => update('name', event.target.value)} required />
              </Field>
              <Field label={t('connectors.table.lastUpdated')}>
                <Input value={formatDateTime(connector.updatedAt)} readOnly />
              </Field>
            </div>
            <Field label={t('connectors.form.description')}>
              <textarea
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.description}
                onChange={(event) => update('description', event.target.value)}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <ReadOnlyPill
                label={t('connectors.form.direction')}
                value={t(`connectors.direction.${connector.direction}` as TranslationKey)}
              />
              <ReadOnlyPill
                label={t('connectors.form.type')}
                value={t(`connectors.type.${connector.type}` as TranslationKey)}
              />
            </div>
          </Section>

          {(connector.type === 'kafka' || connector.type === 'redis') && (
            <ConnectionConfigSection connector={connector} form={form} onUpdate={updateConnection} />
          )}

          {connector.type === 'kafka' && (
            <KafkaConfigSection
              direction={connector.direction}
              form={form}
              onUpdate={update}
              onGenerateGroup={() => update('configConsumerGroup', generateGroupId(connector.name))}
              connector={connector}
              onProbe={connector.direction === 'input' ? () => void runQueueProbe() : undefined}
              probeDisabled={updateMutation.isPending || peekMutation.isPending}
              probing={peekMutation.isPending}
            />
          )}

          {connector.type === 'redis' && (
            <RedisConfigSection
              direction={connector.direction}
              form={form}
              onUpdate={update}
              connector={connector}
              onProbe={connector.direction === 'input' ? () => void runQueueProbe() : undefined}
              probeDisabled={updateMutation.isPending || peekMutation.isPending}
              probing={peekMutation.isPending}
            />
          )}

          {connector.type === 'webhook' && (
            <WebhookSection
              connector={connector}
              form={form}
              webhookApiPath={webhookApiPath}
              tokenRows={tokenRows}
              tokensLoading={webhookTokensQuery.isLoading}
              tokensError={webhookTokensQuery.isError}
              generatedTokenResult={generatedTokenResult}
              revealedTokens={revealedTokens}
              visibleTokenIds={visibleTokenIds}
              curlExample={curlExample}
              responseExample={webhookResponseExample}
              asyncQueryCurlExample={asyncQueryCurlExample}
              asyncQueryResponseExample={asyncQueryResponseExample}
              requestBodyExample={JSON.stringify(samplePayload, null, 2)}
              requestBodyFields={form.requestFields}
              onUpdate={update}
              onRequestFieldChange={updateRequestField}
              onAddRequestField={addRequestField}
              onRemoveRequestField={removeRequestField}
              onCreateToken={openTokenCreateDialog}
              onToggleTokenPlaintext={(token) => void toggleTokenPlaintext(token)}
              onRevokeToken={setTokenRevokeTarget}
              onCopy={(value, message) => void copyText(value, message)}
              creatingToken={createTokenMutation.isPending}
              revealingToken={revealTokenMutation.isPending}
              revokingToken={revokeTokenMutation.isPending}
            />
          )}

          <Section title={t('connectors.section.references')}>
            {referencesQuery.data && referencesQuery.data.references.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('connectors.detail.referencesEmpty')}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {referencesQuery.data?.references.map((ref) => (
                  <li
                    key={ref.id}
                    className="flex items-center justify-between rounded-md border bg-background px-3 py-2"
                  >
                    <span>{ref.name ?? ref.id}</span>
                    <span className="text-xs text-muted-foreground">
                      {ref.kind} · {ref.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </form>
      </div>

      <Dialog open={tokenCreate.open} onOpenChange={(open) => !open && closeTokenCreateDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('connectors.token.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('connectors.token.dialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t('connectors.token.name')} required>
              <Input
                value={tokenCreate.name}
                onChange={(event) => setTokenCreate((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </Field>
            <Field label={t('connectors.token.expiresAt')}>
              <select
                value={tokenCreate.expiryPreset}
                onChange={(event) =>
                  setTokenCreate((prev) => ({
                    ...prev,
                    expiryPreset: event.target.value as TokenExpiryPreset,
                    customExpiresAt:
                      event.target.value === 'custom' ? prev.customExpiresAt : EMPTY_TOKEN_CREATE.customExpiresAt,
                  }))
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="never">{t('connectors.token.expiry.never')}</option>
                <option value="7d">{t('connectors.token.expiry.7d')}</option>
                <option value="30d">{t('connectors.token.expiry.30d')}</option>
                <option value="90d">{t('connectors.token.expiry.90d')}</option>
                <option value="custom">{t('connectors.token.expiry.custom')}</option>
              </select>
            </Field>
            {tokenCreate.expiryPreset === 'custom' ? (
              <Field label={t('connectors.token.customExpiresAt')} required>
                <Input
                  type="datetime-local"
                  value={tokenCreate.customExpiresAt}
                  onChange={(event) => setTokenCreate((prev) => ({ ...prev, customExpiresAt: event.target.value }))}
                  required
                />
              </Field>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeTokenCreateDialog}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void submitCreateToken()}
              disabled={
                createTokenMutation.isPending ||
                updateMutation.isPending ||
                tokenCreate.name.trim().length < 2 ||
                (tokenCreate.expiryPreset === 'custom' && tokenCreate.customExpiresAt.trim().length === 0)
              }
            >
              {createTokenMutation.isPending
                ? t('connectors.token.creating')
                : t('connectors.token.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!tokenRevokeTarget} onOpenChange={(open) => !open && setTokenRevokeTarget(null)}>
        <DialogContent data-testid="project-connector-webhook-token-revoke-dialog">
          <DialogHeader>
            <DialogTitle>{t('connectors.token.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('connectors.token.deleteDescription')}</DialogDescription>
          </DialogHeader>
          {tokenRevokeTarget ? (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">{tokenRevokeTarget.name}</span>
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {maskToken(tokenRevokeTarget.prefix)}
              </span>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setTokenRevokeTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void submitRevokeToken()}
              disabled={revokeTokenMutation.isPending}
            >
              {revokeTokenMutation.isPending
                ? t('connectors.token.deleting')
                : t('connectors.token.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteState.open} onOpenChange={(open) => !open && setDeleteState(EMPTY_DELETE)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {totalRefs > 0
                ? t('connectors.delete.referencedTitle')
                : t('connectors.delete.confirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {totalRefs > 0 ? t('connectors.delete.referencedBody') : t('connectors.delete.confirmBody')}
            </DialogDescription>
          </DialogHeader>
          {totalRefs > 0 && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 cursor-pointer"
                  checked={deleteState.force}
                  onChange={(event) => setDeleteState((prev) => ({ ...prev, force: event.target.checked }))}
                />
                {t('connectors.delete.forceLabel')}
              </label>
              {deleteState.force && (
                <div>
                  <Label className="text-xs">{t('connectors.delete.reasonLabel')}</Label>
                  <Input
                    value={deleteState.reason}
                    onChange={(event) => setDeleteState((prev) => ({ ...prev, reason: event.target.value }))}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteState(EMPTY_DELETE)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitDelete()}
              disabled={
                (totalRefs > 0 && (!deleteState.force || deleteState.reason.trim().length === 0)) ||
                deleteMutation.isPending
              }
            >
              {t('connectors.action.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Main>
  );
}

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ReadOnlyPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function SourceBadge({ label }: { label: string }) {
  return (
    <span
      className="max-w-full truncate rounded-full border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
      data-testid="project-connector-source-badge"
    >
      {label}
    </span>
  );
}

function ConnectionConfigSection({
  connector,
  form,
  onUpdate,
}: {
  connector: ConnectorDetailDto;
  form: DetailFormState;
  onUpdate: <K extends keyof DetailFormState>(key: K, value: DetailFormState[K]) => void;
}) {
  const { t } = useI18n();
  const sourceLabel = t('connectors.form.sourceLocalConfig');

  return (
    <Section title={t('connectors.section.connectionConfig')} actions={<SourceBadge label={sourceLabel} />}>
      {connector.type === 'redis' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('connectors.form.config.host')} required>
            <Input
              value={form.connectionHost}
              onChange={(event) => onUpdate('connectionHost', event.target.value)}
              required
              data-testid="project-connector-connection-host"
            />
          </Field>
          <Field label={t('connectors.form.config.port')} required>
            <Input
              type="number"
              value={form.connectionPort}
              onChange={(event) => onUpdate('connectionPort', event.target.value)}
              required
              data-testid="project-connector-connection-port"
            />
          </Field>
          <Field label={t('connectors.form.config.deploymentType')}>
            <select
              value={form.connectionDeploymentType}
              onChange={(event) =>
                onUpdate('connectionDeploymentType', event.target.value as DetailFormState['connectionDeploymentType'])
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              data-testid="project-connector-connection-deployment-type"
            >
              <option value="standalone">standalone</option>
              <option value="sentinel">sentinel</option>
              <option value="cluster">cluster</option>
            </select>
          </Field>
          <Field label={t('connectors.form.config.defaultDbIndex')}>
            <Input
              type="number"
              value={form.connectionDefaultDbIndex}
              onChange={(event) => onUpdate('connectionDefaultDbIndex', event.target.value)}
              data-testid="project-connector-connection-default-db"
            />
          </Field>
          <Field label={t('connectors.form.config.username')}>
            <Input
              value={form.connectionUsername}
              onChange={(event) => onUpdate('connectionUsername', event.target.value)}
              data-testid="project-connector-connection-username"
            />
          </Field>
          <Field label={t('connectors.form.config.password')} hint={t('connectors.detail.secretHint')}>
            <Input
              type="password"
              value={form.connectionPassword}
              onChange={(event) => onUpdate('connectionPassword', event.target.value)}
              autoComplete="new-password"
              data-testid="project-connector-connection-password"
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label={t('connectors.form.config.bootstrapBrokers')} required>
            <textarea
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.connectionBootstrapBrokers}
              onChange={(event) => onUpdate('connectionBootstrapBrokers', event.target.value)}
              required
              data-testid="project-connector-connection-bootstrap-brokers"
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={t('connectors.form.config.securityProtocol')}>
              <select
                value={form.connectionSecurityProtocol}
                onChange={(event) =>
                  onUpdate(
                    'connectionSecurityProtocol',
                    event.target.value as DetailFormState['connectionSecurityProtocol'],
                  )
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                data-testid="project-connector-connection-security-protocol"
              >
                <option value="PLAINTEXT">PLAINTEXT</option>
                <option value="SSL">SSL</option>
                <option value="SASL_PLAINTEXT">SASL_PLAINTEXT</option>
                <option value="SASL_SSL">SASL_SSL</option>
              </select>
            </Field>
            <Field label={t('connectors.form.config.saslMechanism')}>
              <select
                value={form.connectionSaslMechanism}
                onChange={(event) =>
                  onUpdate('connectionSaslMechanism', event.target.value as DetailFormState['connectionSaslMechanism'])
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                data-testid="project-connector-connection-sasl-mechanism"
              >
                <option value="">-</option>
                <option value="PLAIN">PLAIN</option>
                <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                <option value="SCRAM-SHA-512">SCRAM-SHA-512</option>
              </select>
            </Field>
            <Field label={t('connectors.form.config.saslUsername')}>
              <Input
                value={form.connectionSaslUsername}
                onChange={(event) => onUpdate('connectionSaslUsername', event.target.value)}
                data-testid="project-connector-connection-sasl-username"
              />
            </Field>
          </div>
          <Field
            label={t('connectors.form.config.saslPassword')}
            hint={t('connectors.detail.secretHint')}
          >
            <Input
              type="password"
              value={form.connectionSaslPassword}
              onChange={(event) => onUpdate('connectionSaslPassword', event.target.value)}
              autoComplete="new-password"
              data-testid="project-connector-connection-sasl-password"
            />
          </Field>
        </div>
      )}
    </Section>
  );
}

function KafkaConfigSection({
  direction,
  form,
  onUpdate,
  onGenerateGroup,
  connector,
  onProbe,
  probeDisabled,
  probing,
}: {
  direction: ConnectorDirection;
  form: DetailFormState;
  onUpdate: <K extends keyof DetailFormState>(key: K, value: DetailFormState[K]) => void;
  onGenerateGroup: () => void;
  connector: ConnectorDetailDto;
  onProbe?: () => void;
  probeDisabled?: boolean;
  probing?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Section
      title={t('connectors.section.kafkaQueue')}
      actions={
        direction === 'input' && onProbe ? (
          <Button
            type="button"
            variant="outline"
            onClick={onProbe}
            disabled={probeDisabled}
            data-testid="project-connector-kafka-probe-button"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {probing ? t('connectors.peek.running') : t('connectors.action.peek')}
          </Button>
        ) : null
      }
    >
      <Field
        label={t('connectors.form.config.topic')}
        required
        hint={t('connectors.detail.queueProbeHint')}
      >
        <Input value={form.configTopic} onChange={(event) => onUpdate('configTopic', event.target.value)} required />
      </Field>
      {direction === 'input' ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <Field label={t('connectors.form.config.consumerGroup')} required>
            <Input
              value={form.configConsumerGroup}
              onChange={(event) => onUpdate('configConsumerGroup', event.target.value)}
              required
            />
          </Field>
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={onGenerateGroup}>
              <WandSparkles className="mr-2 h-4 w-4" />
              {t('connectors.detail.generateGroupId')}
            </Button>
          </div>
        </div>
      ) : (
        <Field label={t('connectors.form.config.partitionKey')}>
          <Input
            value={form.configPartitionKey}
            onChange={(event) => onUpdate('configPartitionKey', event.target.value)}
          />
        </Field>
      )}
      {direction === 'input' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 cursor-pointer"
            checked={form.configFromBeginning}
            onChange={(event) => onUpdate('configFromBeginning', event.target.checked)}
          />
          {t('connectors.form.config.fromBeginning')}
        </label>
      ) : null}
      {direction === 'input' ? <LatestQueueProbePanel connector={connector} /> : null}
    </Section>
  );
}

function RedisConfigSection({
  direction,
  form,
  onUpdate,
  connector,
  onProbe,
  probeDisabled,
  probing,
}: {
  direction: ConnectorDirection;
  form: DetailFormState;
  onUpdate: <K extends keyof DetailFormState>(key: K, value: DetailFormState[K]) => void;
  connector: ConnectorDetailDto;
  onProbe?: () => void;
  probeDisabled?: boolean;
  probing?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Section
      title={t('connectors.section.redisQueue')}
      actions={
        direction === 'input' && onProbe ? (
          <Button
            type="button"
            variant="outline"
            onClick={onProbe}
            disabled={probeDisabled}
            data-testid="project-connector-redis-probe-button"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {probing ? t('connectors.peek.running') : t('connectors.action.peek')}
          </Button>
        ) : null
      }
    >
      <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <Field label={t('connectors.form.config.mode')}>
          <SlidingViewToggle
            value={form.configMode}
            options={[
              { value: 'stream', label: t('connectors.redisMode.stream') },
              { value: 'list', label: t('connectors.redisMode.list') },
            ]}
            ariaLabel={t('connectors.form.config.mode')}
            onChange={(value) => onUpdate('configMode', value)}
            className="w-full"
          />
        </Field>
        <Field
          label={t('connectors.form.config.key')}
          required
          hint={t('connectors.detail.queueProbeHint')}
        >
          <Input value={form.configKey} onChange={(event) => onUpdate('configKey', event.target.value)} required />
        </Field>
      </div>
      {direction === 'output' ? (
        <Field label={t('connectors.form.config.maxLen')}>
          <Input
            type="number"
            value={form.configMaxLen}
            onChange={(event) => onUpdate('configMaxLen', event.target.value)}
          />
        </Field>
      ) : null}
      {direction === 'input' ? <LatestQueueProbePanel connector={connector} /> : null}
    </Section>
  );
}

function LatestQueueProbePanel({ connector }: { connector: ConnectorDetailDto }) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const config: Record<string, unknown> = isRecord(connector.config) ? connector.config : {};
  const message = readLatestPeekMessage(config['lastPeekMessage']);
  const payloadSchema = isRecord(config['lastPeekPayloadSchema']) ? config['lastPeekPayloadSchema'] : null;
  const payloadFields = payloadSchema ? schemaToFields(payloadSchema) : [];
  const peekedAt = typeof config['lastPeekedAt'] === 'string' ? config['lastPeekedAt'] : connector.lastProbedAt;
  const status = connector.lastProbedAt ? (connector.lastProbeError ? 'failed' : 'success') : 'pending';

  return (
    <div className="space-y-3 rounded-md border bg-background p-3" data-testid="project-connector-latest-probe">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{t('connectors.peek.latestResult')}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ProbeStatusBadge status={status} />
          <span>{peekedAt ? formatDateTime(peekedAt) : t('connectors.detail.health.never')}</span>
        </div>
      </div>

      {connector.lastProbeError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {connector.lastProbeError}
        </p>
      ) : null}

      {message ? (
        <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-2 text-xs">
            <div>
              <div className="text-muted-foreground">{t('connectors.peek.column.id')}</div>
              <div className="mt-1 break-all font-mono">{message.id}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t('connectors.peek.column.receivedAt')}</div>
              <div className="mt-1">{formatDateTime(message.receivedAt)}</div>
            </div>
          </div>
          <pre
            className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/30 p-3 font-mono text-xs"
            data-testid="project-connector-latest-probe-payload"
          >
            {JSON.stringify(message.payload, null, 2)}
          </pre>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('connectors.peek.empty')}</p>
      )}

      {payloadFields.length > 0 ? (
        <details className="rounded-md border bg-muted/20">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
            {t('connectors.peek.latestSchema')}
          </summary>
          <div className="overflow-hidden border-t bg-background" data-testid="project-connector-latest-schema-table">
            <Table columns={LATEST_SCHEMA_COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead column="key">{t('connectors.detail.field.key')}</TableHead>
                  <TableHead column="type">{t('connectors.detail.field.type')}</TableHead>
                  <TableHead column="description">{t('connectors.detail.field.description')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payloadFields.map((field) => (
                  <TableRow key={`${field.key}:${field.type}`}>
                    <TableCell column="key" className="font-mono text-xs" truncate>
                      {field.key}
                    </TableCell>
                    <TableCell column="type" className="text-muted-foreground">
                      {field.type}
                    </TableCell>
                    <TableCell column="description" className="text-muted-foreground" truncate>
                      {field.description || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ProbeStatusBadge({ status }: { status: 'success' | 'failed' | 'pending' }) {
  const { t } = useI18n();
  const label =
    status === 'success'
      ? t('connectors.probe.success')
      : status === 'failed'
        ? t('connectors.probe.failed')
        : t('connectors.probe.pending');
  return (
    <span className="rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{label}</span>
  );
}

function WebhookSection({
  connector,
  form,
  webhookApiPath,
  tokenRows,
  tokensLoading,
  tokensError,
  generatedTokenResult,
  revealedTokens,
  visibleTokenIds,
  curlExample,
  responseExample,
  asyncQueryCurlExample,
  asyncQueryResponseExample,
  requestBodyExample,
  requestBodyFields,
  onUpdate,
  onRequestFieldChange,
  onAddRequestField,
  onRemoveRequestField,
  onCreateToken,
  onToggleTokenPlaintext,
  onRevokeToken,
  onCopy,
  creatingToken,
  revealingToken,
  revokingToken,
}: {
  connector: ConnectorDetailDto;
  form: DetailFormState;
  webhookApiPath: string;
  tokenRows: ConnectorWebhookTokenSummaryDto[];
  tokensLoading: boolean;
  tokensError: boolean;
  generatedTokenResult: CreateWebhookTokenResponseDto | null;
  revealedTokens: Record<string, string>;
  visibleTokenIds: Set<string>;
  curlExample: string;
  responseExample: string;
  asyncQueryCurlExample: string;
  asyncQueryResponseExample: string;
  requestBodyExample: string;
  requestBodyFields: RequestField[];
  onUpdate: <K extends keyof DetailFormState>(key: K, value: DetailFormState[K]) => void;
  onRequestFieldChange: (index: number, patch: Partial<RequestField>) => void;
  onAddRequestField: () => void;
  onRemoveRequestField: (index: number) => void;
  onCreateToken: () => void;
  onToggleTokenPlaintext: (token: ConnectorWebhookTokenSummaryDto) => void;
  onRevokeToken: (token: ConnectorWebhookTokenSummaryDto) => void;
  onCopy: (value: string, message: string) => void;
  creatingToken: boolean;
  revealingToken: boolean;
  revokingToken: boolean;
}) {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  return (
    <>
      <Section title={t('connectors.section.webhook')}>
        {connector.direction === 'input' ? (
          <>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_300px]">
              <Field label={t('connectors.detail.webhookSlug')} required>
                <Input
                  value={form.webhookSlug}
                  onChange={(event) => onUpdate('webhookSlug', normalizeSlugInput(event.target.value))}
                  required
                />
              </Field>
              <Field label={t('connectors.detail.pathName')} hint={t('connectors.detail.pathNameHint')}>
                <Input
                  value={form.webhookPathName}
                  onChange={(event) => onUpdate('webhookPathName', normalizePathNameInput(event.target.value))}
                />
              </Field>
              <Field label={t('connectors.form.webhook.mode')}>
                <div className="grid grid-cols-2 rounded-md border bg-background p-1" role="group">
                  {(['sync', 'async'] as const).map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={form.webhookMode === mode ? 'default' : 'ghost'}
                      className="h-8 justify-center px-2 text-xs"
                      aria-pressed={form.webhookMode === mode}
                      onClick={() => onUpdate('webhookMode', mode)}
                    >
                      {t(`connectors.form.webhook.mode.${mode}` as TranslationKey)}
                    </Button>
                  ))}
                </div>
              </Field>
            </div>
            <Field label={t('connectors.detail.webhookPath')}>
              <div className="flex gap-2">
                <code
                  className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs"
                  data-testid="project-connector-webhook-path"
                >
                  {webhookApiPath}
                </code>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => onCopy(webhookApiPath, t('connectors.detail.copied'))}
                  aria-label={t('connectors.detail.webhookPathCopy')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              {form.webhookMode === 'sync' ? (
                <Field label={t('connectors.form.webhook.timeoutSeconds')}>
                  <Input
                    type="number"
                    value={form.webhookTimeoutSeconds}
                    onChange={(event) => onUpdate('webhookTimeoutSeconds', event.target.value)}
                  />
                </Field>
              ) : null}
              <Field
                label={t('connectors.form.webhook.ipWhitelist')}
                hint={t('connectors.form.webhook.ipWhitelistPending')}
              >
                <textarea
                  rows={2}
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                  value={form.ipWhitelistRaw}
                  onChange={(event) => onUpdate('ipWhitelistRaw', event.target.value)}
                  placeholder="10.0.0.0/8&#10;192.168.1.0/24"
                />
              </Field>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <ExampleBlock
                title={t('connectors.detail.example.curl')}
                value={curlExample}
                onCopy={() => onCopy(curlExample, t('connectors.detail.copied'))}
              />
              <ExampleBlock
                title={t('connectors.detail.example.response')}
                value={responseExample}
                onCopy={() => onCopy(responseExample, t('connectors.detail.copied'))}
              />
            </div>
            {form.webhookMode === 'async' ? (
              <>
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {t('connectors.detail.asyncRetention')}
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  <ExampleBlock
                    title={t('connectors.detail.example.asyncQueryCurl')}
                    value={asyncQueryCurlExample}
                    onCopy={() => onCopy(asyncQueryCurlExample, t('connectors.detail.copied'))}
                  />
                  <ExampleBlock
                    title={t('connectors.detail.example.asyncQueryResponse')}
                    value={asyncQueryResponseExample}
                    onCopy={() => onCopy(asyncQueryResponseExample, t('connectors.detail.copied'))}
                  />
                </div>
              </>
            ) : null}
          </>
        ) : (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
            <Field label={t('connectors.form.webhook.targetUrl')} required>
              <Input
                value={form.webhookTargetUrl}
                onChange={(event) => onUpdate('webhookTargetUrl', event.target.value)}
                required
              />
            </Field>
            <Field label={t('connectors.form.webhook.method')}>
              <select
                value={form.webhookMethod}
                onChange={(event) => onUpdate('webhookMethod', event.target.value as 'POST' | 'PUT')}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
              </select>
            </Field>
          </div>
        )}
      </Section>

      {connector.direction === 'input' ? (
        <>
          <Section
            title={t('connectors.section.token')}
            actions={
              <Button
                type="button"
                variant="outline"
                onClick={onCreateToken}
                disabled={creatingToken}
                data-testid="project-connector-webhook-token-create"
              >
                <KeyRound className="mr-2 h-4 w-4" />
                {creatingToken ? t('connectors.token.creating') : t('connectors.token.create')}
              </Button>
            }
          >
            <p className="text-sm text-muted-foreground">{t('connectors.section.tokenDescription')}</p>
            {generatedTokenResult ? (
              <PlaintextResultBanner
                title={t('connectors.token.initialTitle')}
                description={t('connectors.token.initialHint')}
                plaintext={generatedTokenResult.plaintext}
                onCopy={() => onCopy(generatedTokenResult.plaintext, t('connectors.detail.copied'))}
              />
            ) : null}
            {tokensError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {t('connectors.token.loadFailed')}
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border" data-testid="project-connector-webhook-token-table">
                <Table columns={TOKEN_COLUMNS}>
                  <TableHeader>
                    <TableRow>
                      <TableHead column="name">{t('connectors.token.column.name')}</TableHead>
                      <TableHead column="token">{t('connectors.token.column.token')}</TableHead>
                      <TableHead column="lastUsedAt">{t('connectors.token.column.lastUsedAt')}</TableHead>
                      <TableHead column="expiresAt">{t('connectors.token.column.expiresAt')}</TableHead>
                      <TableHead column="createdAt">{t('connectors.token.column.createdAt')}</TableHead>
                      <TableHead column="actions" className="text-right">
                        {t('common.actions')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokenRows.length === 0 ? (
                      <TableEmpty>
                        {tokensLoading ? t('common.loading') : t('connectors.token.empty')}
                      </TableEmpty>
                    ) : (
                      tokenRows.map((token) => (
                        <TableRow key={token.id}>
                          <TableCell column="name" truncate>
                            {token.name}
                          </TableCell>
                          <TableCell column="token">
                            <TokenPlaintextCell
                              token={token}
                              plaintext={revealedTokens[token.id]}
                              visible={visibleTokenIds.has(token.id)}
                              revealing={revealingToken}
                              onToggle={() => onToggleTokenPlaintext(token)}
                              onCopy={(plaintext) => onCopy(plaintext, t('connectors.detail.copied'))}
                            />
                          </TableCell>
                          <TableCell column="lastUsedAt">
                            {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : '-'}
                          </TableCell>
                          <TableCell column="expiresAt">
                            {token.expiresAt ? formatDateTime(token.expiresAt) : '-'}
                          </TableCell>
                          <TableCell column="createdAt">{formatDateTime(token.createdAt)}</TableCell>
                          <TableCell column="actions">
                            <div className="flex items-center justify-end">
                              <TableActionIconButton
                                label={t('connectors.token.delete')}
                                onClick={() => onRevokeToken(token)}
                                disabled={revokingToken}
                                className="text-destructive hover:text-destructive"
                                data-testid={`project-connector-webhook-token-revoke-${token.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </TableActionIconButton>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <Section
            title={t('connectors.section.requestBody')}
            actions={
              <Button type="button" variant="outline" onClick={onAddRequestField}>
                <Plus className="mr-2 h-4 w-4" />
                {t('connectors.detail.field.add')}
              </Button>
            }
          >
            <div className="overflow-hidden rounded-md border">
              <Table columns={FIELD_COLUMNS}>
                <TableHeader>
                  <TableRow>
                    <TableHead column="key">{t('connectors.detail.field.key')}</TableHead>
                    <TableHead column="type">{t('connectors.detail.field.type')}</TableHead>
                    <TableHead column="description">{t('connectors.detail.field.description')}</TableHead>
                    <TableHead column="actions">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requestBodyFields.map((field, index) => (
                    <TableRow key={`request-field-${index}`}>
                      <TableCell column="key">
                        <Input
                          value={field.key}
                          onChange={(event) =>
                            onRequestFieldChange(index, { key: normalizeFieldKey(event.target.value) })
                          }
                          className="font-mono text-xs"
                          aria-label={t('connectors.detail.field.key')}
                        />
                      </TableCell>
                      <TableCell column="type">
                        <select
                          value={field.type}
                          onChange={(event) =>
                            onRequestFieldChange(index, { type: event.target.value as RequestFieldType })
                          }
                          className="w-full rounded-md border bg-background px-2 py-2 text-xs"
                          aria-label={t('connectors.detail.field.type')}
                        >
                          {REQUEST_FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell column="description">
                        <Input
                          value={field.description}
                          onChange={(event) => onRequestFieldChange(index, { description: event.target.value })}
                          aria-label={t('connectors.detail.field.description')}
                        />
                      </TableCell>
                      <TableCell column="actions">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemoveRequestField(index)}
                          disabled={requestBodyFields.length <= 1}
                          aria-label={t('connectors.detail.field.remove')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ExampleBlock
              title={t('connectors.detail.example.body')}
              value={requestBodyExample}
              onCopy={() => onCopy(requestBodyExample, t('connectors.detail.copied'))}
            />
          </Section>
        </>
      ) : null}
    </>
  );
}

function ExampleBlock({ title, value, onCopy }: { title: string; value: string; onCopy: () => void }) {
  return (
    <div className="min-w-0 rounded-md border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        <Button type="button" variant="ghost" size="icon" onClick={onCopy} aria-label={title}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs">{value}</pre>
    </div>
  );
}

function TokenPlaintextCell({
  token,
  plaintext,
  visible,
  revealing,
  onToggle,
  onCopy,
}: {
  token: ConnectorWebhookTokenSummaryDto;
  plaintext?: string;
  visible: boolean;
  revealing: boolean;
  onToggle: () => void;
  onCopy: (plaintext: string) => void;
}) {
  const { t } = useI18n();
  const canCopy = Boolean(plaintext);
  const displayValue = visible && plaintext ? plaintext : maskToken(token.prefix, plaintext);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs">
        {displayValue}
      </code>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onToggle}
        disabled={revealing}
        aria-label={visible ? t('connectors.token.hide') : t('connectors.token.show')}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => plaintext && onCopy(plaintext)}
        disabled={!canCopy}
        aria-label={t('connectors.token.copy')}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

function PlaintextResultBanner({
  title,
  description,
  plaintext,
  onCopy,
}: {
  title: string;
  description: string;
  plaintext: string;
  onCopy: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3" data-testid="project-connector-webhook-token-plaintext-banner">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant="outline" onClick={onCopy}>
          <Copy className="mr-2 h-4 w-4" />
          {t('connectors.token.copy')}
        </Button>
      </div>
      <code className="mt-3 block overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs">
        {plaintext}
      </code>
    </div>
  );
}

function connectorToState(
  connector: ConnectorDetailDto | null,
  defaultWebhookSchema: Record<string, unknown>,
  defaultWebhookSlug: string,
): DetailFormState {
  const cfg = (connector?.config as Record<string, unknown> | undefined) ?? {};
  const connection = isRecord(cfg['connection']) ? cfg['connection'] : {};
  const schema = cfg['expectedPayloadSchema'] ?? defaultWebhookSchema;
  const requestFields = schemaToFields(schema);
  return {
    name: connector?.name ?? '',
    description: connector?.description ?? '',
    connectionSource: readConnectionSource(connection['source']),
    connectionHost: typeof connection['host'] === 'string' ? connection['host'] : '',
    connectionPort: connection['port'] != null ? String(connection['port']) : '6379',
    connectionUsername: typeof connection['username'] === 'string' ? connection['username'] : '',
    connectionDefaultDbIndex: connection['defaultDbIndex'] != null ? String(connection['defaultDbIndex']) : '0',
    connectionDeploymentType: readRedisDeploymentType(connection['deploymentType']) ?? 'standalone',
    connectionPassword: '',
    connectionBootstrapBrokers: Array.isArray(connection['bootstrapBrokers'])
      ? connection['bootstrapBrokers'].filter((item): item is string => typeof item === 'string').join('\n')
      : '',
    connectionSecurityProtocol: readKafkaSecurityProtocol(connection['securityProtocol']) ?? 'PLAINTEXT',
    connectionSaslMechanism: readKafkaSaslMechanism(connection['saslMechanism']) ?? '',
    connectionSaslUsername: typeof connection['saslUsername'] === 'string' ? connection['saslUsername'] : '',
    connectionSaslPassword: '',
    configMode: (cfg['mode'] as 'list' | 'stream' | undefined) ?? 'stream',
    configKey: typeof cfg['key'] === 'string' ? cfg['key'] : '',
    configConsumerGroup:
      connector?.type === 'kafka' && typeof cfg['consumerGroup'] === 'string' ? cfg['consumerGroup'] : '',
    configMaxLen: cfg['maxLen'] != null ? String(cfg['maxLen']) : '',
    configTopic: typeof cfg['topic'] === 'string' ? cfg['topic'] : '',
    configFromBeginning: Boolean(cfg['fromBeginning']),
    configPartitionKey: typeof cfg['partitionKey'] === 'string' ? cfg['partitionKey'] : '',
    ipWhitelistRaw: connector?.ipWhitelist?.join('\n') ?? '',
    webhookMode: (cfg['webhookMode'] as 'sync' | 'async' | undefined) ?? 'sync',
    webhookTimeoutSeconds: cfg['timeoutSeconds'] != null ? String(cfg['timeoutSeconds']) : '30',
    webhookTargetUrl: typeof cfg['targetUrl'] === 'string' ? cfg['targetUrl'] : '',
    webhookMethod: (cfg['method'] as 'POST' | 'PUT' | undefined) ?? 'POST',
    webhookSlug:
      typeof cfg['webhookSlug'] === 'string' && cfg['webhookSlug'].trim().length > 0
        ? safeWebhookSlug(cfg['webhookSlug'])
        : defaultWebhookSlug,
    webhookPathName:
      typeof cfg['pathName'] === 'string' && cfg['pathName'].trim().length > 0 ? finalizePathName(cfg['pathName']) : '',
    requestFields: requestFields.length > 0 ? requestFields : schemaToFields(defaultWebhookSchema),
  };
}

function buildUpdatePayload(connector: ConnectorDetailDto, form: DetailFormState): UpdateConnectorDto {
  const body: UpdateConnectorDto = {
    name: form.name.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
  };
  if (connector.type === 'redis') {
    const mode = form.configMode;
    const key = form.configKey.trim();
    body.config =
      connector.direction === 'input'
        ? {
            connection: buildRedisConnectionConfig(form),
            mode,
            key,
            ...(shouldPreserveLatestPeekConfig(connector.config, { type: 'redis', mode, key })
              ? pickLatestPeekConfig(connector.config)
              : {}),
          }
        : {
            connection: buildRedisConnectionConfig(form),
            mode,
            key,
            maxLen: form.configMaxLen ? Number(form.configMaxLen) : undefined,
          };
    if (form.connectionPassword.trim().length > 0) {
      body.credentials = { password: form.connectionPassword.trim() };
    }
  } else if (connector.type === 'kafka') {
    const topic = form.configTopic.trim();
    body.config =
      connector.direction === 'input'
        ? {
            connection: buildKafkaConnectionConfig(form),
            topic,
            consumerGroup: form.configConsumerGroup.trim(),
            fromBeginning: form.configFromBeginning || undefined,
            ...(shouldPreserveLatestPeekConfig(connector.config, { type: 'kafka', topic })
              ? pickLatestPeekConfig(connector.config)
              : {}),
          }
        : {
            connection: buildKafkaConnectionConfig(form),
            topic,
            partitionKey: form.configPartitionKey.trim() || undefined,
          };
    if (form.connectionSaslPassword.trim().length > 0) {
      body.credentials = { saslPassword: form.connectionSaslPassword.trim() };
    }
  } else if (connector.direction === 'input') {
    const pathName = finalizePathName(form.webhookPathName);
    body.config = {
      webhookMode: form.webhookMode,
      webhookSlug: safeWebhookSlug(form.webhookSlug),
      ...(pathName ? { pathName } : {}),
      timeoutSeconds:
        form.webhookMode === 'sync' && form.webhookTimeoutSeconds ? Number(form.webhookTimeoutSeconds) : undefined,
      expectedPayloadSchema: fieldsToJsonSchema(form.requestFields),
    };
    // Webhook tokens are no longer written via connector update (scope='webhook' self-managed); only the IP whitelist remains.
    body.ipWhitelist = parseIpWhitelist(form.ipWhitelistRaw);
  } else {
    body.config = { targetUrl: form.webhookTargetUrl.trim(), method: form.webhookMethod };
  }
  return body;
}

function buildRedisConnectionConfig(form: DetailFormState): RedisConnectionConfig {
  return {
    source: form.connectionSource,
    host: form.connectionHost.trim(),
    port: Number(form.connectionPort),
    username: form.connectionUsername.trim() || null,
    defaultDbIndex: form.connectionDefaultDbIndex.trim() ? Number(form.connectionDefaultDbIndex) : null,
    deploymentType: form.connectionDeploymentType,
  };
}

function buildKafkaConnectionConfig(form: DetailFormState): KafkaConnectionConfig {
  return {
    source: form.connectionSource,
    bootstrapBrokers: form.connectionBootstrapBrokers
      .split(/[\n,]/u)
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    securityProtocol: form.connectionSecurityProtocol,
    saslMechanism: form.connectionSaslMechanism || null,
    saslUsername: form.connectionSaslUsername.trim() || null,
  };
}

function shouldPreserveLatestPeekConfig(
  config: ConnectorDetailDto['config'],
  next: { type: 'redis'; mode: DetailFormState['configMode']; key: string } | { type: 'kafka'; topic: string },
): boolean {
  const record: Record<string, unknown> = isRecord(config) ? config : {};
  if (next.type === 'redis') return record['mode'] === next.mode && record['key'] === next.key;
  return record['topic'] === next.topic;
}

function pickLatestPeekConfig(config: ConnectorDetailDto['config']): LatestPeekConfig {
  const record: Record<string, unknown> = isRecord(config) ? config : {};
  const result: LatestPeekConfig = {};
  if (isRecord(record['lastPeekPayloadSchema']) || record['lastPeekPayloadSchema'] === null) {
    result.lastPeekPayloadSchema = record['lastPeekPayloadSchema'];
  }
  const latestMessage = readLatestPeekMessage(record['lastPeekMessage']);
  if (latestMessage || record['lastPeekMessage'] === null) result.lastPeekMessage = latestMessage;
  if (typeof record['lastPeekedAt'] === 'string') result.lastPeekedAt = record['lastPeekedAt'];
  if (typeof record['lastPeekMessageCount'] === 'number') {
    result.lastPeekMessageCount = record['lastPeekMessageCount'];
  }
  return result;
}

function readLatestPeekMessage(value: unknown): PeekConnectorMessageDto | null {
  if (!isRecord(value) || typeof value['id'] !== 'string') return null;
  const receivedAt = typeof value['receivedAt'] === 'string' ? value['receivedAt'] : null;
  return {
    id: value['id'],
    receivedAt,
    payload: value['payload'],
    ...(isRecord(value['metadata']) ? { metadata: value['metadata'] } : {}),
  };
}

function parseIpWhitelist(raw: string): string[] | null {
  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return rows.length > 0 ? rows : null;
}

function schemaToFields(value: unknown): RequestField[] {
  if (!isRecord(value)) return [];
  const properties = isRecord(value['properties']) ? value['properties'] : value;
  return flattenSchemaProperties(properties);
}

function flattenSchemaProperties(properties: Record<string, unknown>, prefix = ''): RequestField[] {
  const skipKeys = new Set([
    'type',
    'properties',
    'required',
    'additionalProperties',
    '$schema',
    'title',
    'description',
  ]);
  return Object.entries(properties).flatMap(([key, fieldValue]) => {
    if (skipKeys.has(key)) return [];
    const record = isRecord(fieldValue) ? fieldValue : {};
    const rawType = typeof record['type'] === 'string' ? record['type'] : inferFieldType(fieldValue);
    const type = isRequestFieldType(rawType) ? rawType : 'string';
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const field: RequestField = {
      key: fullKey,
      type,
      description: typeof record['description'] === 'string' ? record['description'] : '',
    };
    if (type === 'object' && isRecord(record['properties'])) {
      const children = flattenSchemaProperties(record['properties'], fullKey);
      return children.length > 0 ? [field, ...children] : [field];
    }
    return [field];
  });
}

function fieldsToJsonSchema(fields: RequestField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of fields) {
    const key = normalizeFieldKey(field.key);
    if (!key) continue;
    assignSchemaProperty(properties, key.split('.').filter(Boolean), field);
  }
  return {
    type: 'object',
    properties,
  };
}

function assignSchemaProperty(properties: Record<string, unknown>, path: string[], field: RequestField) {
  const [head, ...rest] = path;
  if (!head) return;
  if (rest.length > 0) {
    const existing = isRecord(properties[head]) ? properties[head] : {};
    const childProperties = isRecord(existing['properties']) ? existing['properties'] : {};
    properties[head] = { ...existing, type: 'object', properties: childProperties };
    assignSchemaProperty(childProperties, rest, field);
    return;
  }

  const existing = isRecord(properties[head]) ? properties[head] : {};
  const nested = isRecord(existing['properties']) ? { properties: existing['properties'] } : {};
  properties[head] = {
    type: field.type,
    ...(field.description.trim() ? { description: field.description.trim() } : {}),
    ...nested,
  };
}

function buildSamplePayload(fields: RequestField[], language: Language): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const key = normalizeFieldKey(field.key);
    if (!key) continue;
    assignSampleValue(payload, key.split('.').filter(Boolean), field, language);
  }
  return payload;
}

function assignSampleValue(target: Record<string, unknown>, path: string[], field: RequestField, language: Language) {
  const [head, ...rest] = path;
  if (!head) return;
  if (rest.length === 0) {
    if (field.type === 'object' && isRecord(target[head])) return;
    target[head] = sampleForType(field.type, field.key, language);
    return;
  }
  const existing = isRecord(target[head]) ? target[head] : {};
  target[head] = existing;
  assignSampleValue(existing, rest, field, language);
}

function sampleForType(type: string, key: string, language: Language): unknown {
  if (type === 'number' || type === 'integer') return 100;
  if (type === 'boolean') return true;
  if (type === 'array') return [];
  if (type === 'object') return { source: 'crm', priority: 'high' };
  if (key.toLowerCase().includes('id')) return 'req_20260520_001';
  return language === 'en-US' ? 'Business content to process with the prompt' : '需要提示词处理的业务内容';
}

function getDefaultWebhookSchema(language: Language): Record<string, unknown> {
  return language === 'en-US' ? DEFAULT_WEBHOOK_SCHEMA_EN : DEFAULT_WEBHOOK_SCHEMA_ZH;
}

function buildWebhookApiPath(webhookSlug: string, pathName: string): string {
  const safeWebhook = safeWebhookSlug(webhookSlug);
  const safePathName = finalizePathName(pathName);
  return safePathName
    ? `${WEBHOOK_PATH_PREFIX}/${safeWebhook}/${safePathName}`
    : `${WEBHOOK_PATH_PREFIX}/${safeWebhook}`;
}

function buildWebhookResponseExample(mode: 'sync' | 'async', language: Language): string {
  const value =
    mode === 'sync'
      ? {
          status: 'success',
          result: language === 'en-US' ? 'model output' : '模型输出',
        }
      : {
          status: 'accepted',
          call_id: 'call_20260521_001',
        };
  return JSON.stringify(value, null, 2);
}

function buildWebhookAsyncQueryResponseExample(language: Language): string {
  return JSON.stringify(
    {
      status: 'completed',
      call_id: 'call_20260521_001',
      expires_in_seconds: 1800,
      result: language === 'en-US' ? 'model output' : '模型输出',
    },
    null,
    2,
  );
}

// The CreateWebhookTokenResponseDto returned by the create endpoint may not immediately appear in the list endpoint result (the query has not yet refetched).
// Optimistically merge it into the top of the list; it will be reconciled with the server source after the list refreshes.
function mergeGeneratedToken(
  tokens: ConnectorWebhookTokenSummaryDto[],
  generated: CreateWebhookTokenResponseDto | null,
): ConnectorWebhookTokenSummaryDto[] {
  if (!generated) return tokens;
  if (tokens.some((token) => token.id === generated.id)) return tokens;
  const summary: ConnectorWebhookTokenSummaryDto = {
    id: generated.id,
    name: generated.name,
    prefix: generated.prefix,
    expiresAt: generated.expiresAt,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };
  return [summary, ...tokens];
}

function maskToken(prefix: string, plaintext?: string): string {
  if (plaintext) {
    const head = plaintext.slice(0, 12);
    const tail = plaintext.slice(-4);
    return `${head}${'*'.repeat(12)}${tail}`;
  }
  return `${prefix}${'*'.repeat(16)}`;
}

function buildGeneratedTokenName(connectorName: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const base = connectorName.trim().slice(0, 48) || 'webhook';
  return `${base}-token-${timestamp}`;
}

function resolveTokenExpiresAt(state: TokenCreateState): string | null | 'invalid' {
  if (state.expiryPreset === 'never') return null;
  if (state.expiryPreset === 'custom') {
    const date = new Date(state.customExpiresAt);
    return Number.isNaN(date.getTime()) ? 'invalid' : date.toISOString();
  }
  const days = Number.parseInt(state.expiryPreset, 10);
  if (!Number.isFinite(days)) return 'invalid';
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

function buildDefaultWebhookSlug(seed: string): string {
  const normalized = seed.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const suffix = normalized.slice(0, 8) || randomSlugSegment();
  return safeWebhookSlug(`wh-${suffix}`);
}

function randomSlugSegment(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

function normalizeSlugInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function normalizePathNameInput(value: string): string {
  return value
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._/-]+/g, '')
    .replace(/\/{2,}/g, '/')
    .slice(0, 120);
}

function finalizeSlug(value: string): string {
  return normalizeSlugInput(value).replace(/^-+|-+$/g, '');
}

function finalizePathName(value: string): string {
  return normalizePathNameInput(value).replace(/^\/+|\/+$/g, '');
}

function safeWebhookSlug(value: string): string {
  const slug = finalizeSlug(value);
  return slug.length >= 2 ? slug : DEFAULT_WEBHOOK_SLUG;
}

function normalizeFieldKey(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w.-]/gu, '')
    .slice(0, 120);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readConnectionSource(_value: unknown): ConnectionSource {
  return 'local_config';
}

function readRedisDeploymentType(value: unknown): DetailFormState['connectionDeploymentType'] | null {
  return value === 'standalone' || value === 'sentinel' || value === 'cluster' ? value : null;
}

function readKafkaSecurityProtocol(value: unknown): DetailFormState['connectionSecurityProtocol'] | null {
  return value === 'PLAINTEXT' || value === 'SSL' || value === 'SASL_PLAINTEXT' || value === 'SASL_SSL' ? value : null;
}

function readKafkaSaslMechanism(value: unknown): DetailFormState['connectionSaslMechanism'] | null {
  return value === 'PLAIN' || value === 'SCRAM-SHA-256' || value === 'SCRAM-SHA-512' ? value : null;
}

function isRequestFieldType(value: string): value is RequestFieldType {
  return (REQUEST_FIELD_TYPES as readonly string[]).includes(value);
}

function inferFieldType(value: unknown): RequestFieldType {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'string';
  const type = typeof value;
  if (type === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'object') return 'object';
  return 'string';
}

function generateGroupId(name: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return `ph-${slug || 'connector'}-${suffix}`;
}
