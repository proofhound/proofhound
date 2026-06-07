'use client';

import type { CreateUserTokenResponseDto, UserTokenSummaryDto } from '@proofhound/shared';
import { Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableActionIconButton,
  cn,
} from '@proofhound/ui';
import type { TableColumn } from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import {
  useCreateToken,
  useDelayedLoading,
  useDeleteToken,
  useDateTimeFormatter,
  useRevealToken,
  useTokens,
  useUpdateToken,
} from '../../hooks';
import { useI18n } from '../../i18n';
import { getApiErrorMessage } from '../../lib';
type TokenExpiryPreset = 'never' | '7d' | '30d' | '90d' | 'custom';

interface TokenCreateState {
  open: boolean;
  name: string;
  expiryPreset: TokenExpiryPreset;
  customExpiresAt: string;
  ipWhitelistRaw: string;
}

interface TokenEditState {
  open: boolean;
  tokenId: string;
  name: string;
  expiryPreset: TokenExpiryPreset;
  customExpiresAt: string;
}

const EMPTY_CREATE_STATE: TokenCreateState = {
  open: false,
  name: '',
  expiryPreset: 'never',
  customExpiresAt: '',
  ipWhitelistRaw: '',
};

const EMPTY_EDIT_STATE: TokenEditState = {
  open: false,
  tokenId: '',
  name: '',
  expiryPreset: 'never',
  customExpiresAt: '',
};

const TOKEN_COLUMNS: TableColumn[] = [
  { key: 'name', width: 'flex', minPx: 140, sticky: 'left' },
  { key: 'token', width: 'flex', minPx: 240 },
  { key: 'ipWhitelist', width: 'compact' },
  { key: 'lastUsedAt', width: 'compact' },
  { key: 'expiresAt', width: 'compact' },
  { key: 'createdAt', width: 'compact' },
  { key: 'actions', width: 'compact', sticky: 'right' },
];

function resolveExpiresAt(
  state: Pick<TokenCreateState, 'expiryPreset' | 'customExpiresAt'>,
): string | null | undefined {
  if (state.expiryPreset === 'never') return null;
  if (state.expiryPreset === 'custom') {
    const date = new Date(state.customExpiresAt);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const days = state.expiryPreset === '7d' ? 7 : state.expiryPreset === '30d' ? 30 : 90;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function parseIpWhitelist(value: string): string[] | undefined {
  const entries = value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function toDatetimeLocalValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => part.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function createEditState(token: Pick<UserTokenSummaryDto, 'id' | 'name' | 'expiresAt'>): TokenEditState {
  return {
    open: true,
    tokenId: token.id,
    name: token.name,
    expiryPreset: token.expiresAt ? 'custom' : 'never',
    customExpiresAt: toDatetimeLocalValue(token.expiresAt),
  };
}

function maskToken(prefix: string, plaintext?: string): string {
  const visiblePrefix = plaintext?.slice(0, 12) ?? prefix;
  return `${visiblePrefix}••••••`;
}

function mergeCreatedToken(
  rows: UserTokenSummaryDto[],
  created: CreateUserTokenResponseDto | null,
): UserTokenSummaryDto[] {
  if (!created) return rows;
  if (rows.some((row) => row.id === created.token.id)) return rows;
  return [created.token, ...rows];
}

function addSetValue<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  next.add(value);
  return next;
}

function deleteSetValue<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  next.delete(value);
  return next;
}

export function SettingsPage() {
  const { t } = useI18n();
  const { formatDateTime } = useDateTimeFormatter();
  const tokensQuery = useTokens();
  const createTokenMutation = useCreateToken();
  const revealTokenMutation = useRevealToken();
  const updateTokenMutation = useUpdateToken();
  const deleteTokenMutation = useDeleteToken();

  const [createState, setCreateState] = useState<TokenCreateState>(EMPTY_CREATE_STATE);
  const [editState, setEditState] = useState<TokenEditState>(EMPTY_EDIT_STATE);
  const [deleteTarget, setDeleteTarget] = useState<UserTokenSummaryDto | null>(null);
  const [createdToken, setCreatedToken] = useState<CreateUserTokenResponseDto | null>(null);
  const [plaintexts, setPlaintexts] = useState<Record<string, string>>({});
  const [visibleTokenIds, setVisibleTokenIds] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () => mergeCreatedToken(tokensQuery.data?.data ?? [], createdToken),
    [tokensQuery.data?.data, createdToken],
  );

  function showNotice(message: string) {
    setNotice(message);
    setError(null);
  }

  function showError(message: string) {
    setError(message);
    setNotice(null);
  }

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showNotice(t('settings.notice.copied'));
    } catch {
      showError(t('settings.error.copyFailed'));
    }
  }

  async function submitCreateToken() {
    const expiresAt = resolveExpiresAt(createState);
    if (expiresAt === undefined) {
      showError(t('settings.token.invalidExpiresAt'));
      return;
    }

    try {
      const result = await createTokenMutation.mutateAsync({
        name: createState.name.trim(),
        ipWhitelist: parseIpWhitelist(createState.ipWhitelistRaw),
        expiresAt,
      });
      setCreatedToken(result);
      setPlaintexts((prev) => ({ ...prev, [result.token.id]: result.plaintext }));
      setVisibleTokenIds((prev) => addSetValue(prev, result.token.id));
      setCreateState(EMPTY_CREATE_STATE);
      showNotice(t('settings.token.created'));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.token.createFailed'));
    }
  }

  async function toggleTokenPlaintext(token: UserTokenSummaryDto) {
    if (visibleTokenIds.has(token.id)) {
      setVisibleTokenIds((prev) => deleteSetValue(prev, token.id));
      return;
    }

    const cached = plaintexts[token.id];
    if (cached) {
      setVisibleTokenIds((prev) => addSetValue(prev, token.id));
      return;
    }

    try {
      const result = await revealTokenMutation.mutateAsync(token.id);
      if (!result.available || !result.plaintext) {
        showError(t('settings.token.revealUnavailable'));
        return;
      }
      setPlaintexts((prev) => ({ ...prev, [token.id]: result.plaintext! }));
      setVisibleTokenIds((prev) => addSetValue(prev, token.id));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.token.revealFailed'));
    }
  }

  async function submitUpdateToken() {
    const expiresAt = resolveExpiresAt(editState);
    if (expiresAt === undefined) {
      showError(t('settings.token.invalidExpiresAt'));
      return;
    }

    try {
      const result = await updateTokenMutation.mutateAsync({
        tokenId: editState.tokenId,
        body: { name: editState.name.trim(), expiresAt },
      });
      setCreatedToken((prev) => (prev?.token.id === result.token.id ? { ...prev, token: result.token } : prev));
      setEditState(EMPTY_EDIT_STATE);
      showNotice(t('settings.token.updated'));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.token.updateFailed'));
    }
  }

  async function submitDeleteToken() {
    if (!deleteTarget) return;
    try {
      await deleteTokenMutation.mutateAsync(deleteTarget.id);
      setPlaintexts((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      setVisibleTokenIds((prev) => deleteSetValue(prev, deleteTarget.id));
      setCreatedToken((prev) => (prev?.token.id === deleteTarget.id ? null : prev));
      setDeleteTarget(null);
      showNotice(t('settings.token.deleted'));
    } catch (err) {
      showError(getApiErrorMessage(err) ?? t('settings.token.deleteFailed'));
    }
  }

  const loading = useDelayedLoading(tokensQuery.isLoading);

  return (
    <Main className="gap-0">
      <div className="flex flex-col gap-5" data-testid="settings-page">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-normal">{t('settings.title')}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('settings.subtitle')}</p>
        </div>

        {notice ? <StatusBanner tone="success">{notice}</StatusBanner> : null}
        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

        <section className="space-y-4 rounded-lg border bg-card p-4" data-testid="settings-token-section">
          <SectionHeader
            icon={<KeyRound className="h-4 w-4" />}
            title={t('settings.token.title')}
            description={t('settings.token.description')}
            actions={
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateState({ ...EMPTY_CREATE_STATE, open: true })}
                disabled={createTokenMutation.isPending}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('settings.token.create')}
              </Button>
            }
          />

          {createdToken ? (
            <PlaintextResult
              title={t('settings.token.createdTitle')}
              plaintext={createdToken.plaintext}
              onCopy={() => void copyValue(createdToken.plaintext)}
            />
          ) : null}

          {tokensQuery.isError ? (
            <StatusBanner tone="error">{t('settings.token.loadFailed')}</StatusBanner>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table columns={TOKEN_COLUMNS}>
                <TableHeader>
                  <TableRow>
                    <TableHead column="name">{t('settings.token.column.name')}</TableHead>
                    <TableHead column="token">{t('settings.token.column.token')}</TableHead>
                    <TableHead column="ipWhitelist">{t('settings.token.column.ipWhitelist')}</TableHead>
                    <TableHead column="lastUsedAt">{t('settings.token.column.lastUsedAt')}</TableHead>
                    <TableHead column="expiresAt">{t('settings.token.column.expiresAt')}</TableHead>
                    <TableHead column="createdAt">{t('settings.token.column.createdAt')}</TableHead>
                    <TableHead column="actions" className="text-right">
                      {t('common.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableSkeletonRows />
                  ) : rows.length === 0 ? (
                    <TableEmpty>{t('settings.token.empty')}</TableEmpty>
                  ) : (
                    rows.map((token) => (
                      <TableRow key={token.id}>
                        <TableCell column="name" truncate>
                          {token.name}
                        </TableCell>
                        <TableCell column="token">
                          <TokenPlaintextCell
                            prefix={token.prefix}
                            plaintext={plaintexts[token.id]}
                            visible={visibleTokenIds.has(token.id)}
                            revealing={revealTokenMutation.isPending}
                            onToggle={() => void toggleTokenPlaintext(token)}
                            onCopy={(plaintext) => void copyValue(plaintext)}
                          />
                        </TableCell>
                        <TableCell column="ipWhitelist" truncate>
                          {token.ipWhitelist?.length
                            ? token.ipWhitelist.join(', ')
                            : t('settings.token.ipWhitelistNone')}
                        </TableCell>
                        <TableCell column="lastUsedAt">{formatDateTime(token.lastUsedAt)}</TableCell>
                        <TableCell column="expiresAt">{formatDateTime(token.expiresAt)}</TableCell>
                        <TableCell column="createdAt">{formatDateTime(token.createdAt)}</TableCell>
                        <TableCell column="actions">
                          <div className="flex items-center justify-end gap-0.5">
                            <TableActionIconButton
                              label={t('settings.token.edit')}
                              onClick={() => setEditState(createEditState(token))}
                              disabled={updateTokenMutation.isPending}
                            >
                              <Pencil className="h-4 w-4" />
                            </TableActionIconButton>
                            <TableActionIconButton
                              label={t('settings.token.delete')}
                              onClick={() => setDeleteTarget(token)}
                              disabled={deleteTokenMutation.isPending}
                              className="text-destructive hover:text-destructive"
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
        </section>

        <CreateTokenDialog
          state={createState}
          pending={createTokenMutation.isPending}
          onChange={setCreateState}
          onCancel={() => setCreateState(EMPTY_CREATE_STATE)}
          onSubmit={() => void submitCreateToken()}
        />
        <EditTokenDialog
          state={editState}
          pending={updateTokenMutation.isPending}
          onChange={setEditState}
          onCancel={() => setEditState(EMPTY_EDIT_STATE)}
          onSubmit={() => void submitUpdateToken()}
        />
        <DeleteTokenDialog
          open={Boolean(deleteTarget)}
          name={deleteTarget?.name ?? ''}
          prefix={deleteTarget?.prefix ?? ''}
          pending={deleteTokenMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void submitDeleteToken()}
        />
      </div>
    </Main>
  );
}

function SectionHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 rounded-md border bg-background p-2 text-muted-foreground">{icon}</div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions}
    </div>
  );
}

function Field({
  htmlFor,
  label,
  required,
  hint,
  children,
}: {
  htmlFor?: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function CreateTokenDialog({
  state,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  state: TokenCreateState;
  pending: boolean;
  onChange: (state: TokenCreateState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const idPrefix = 'settings-token-create';
  const disabled =
    pending ||
    state.name.trim().length < 2 ||
    (state.expiryPreset === 'custom' && state.customExpiresAt.trim().length === 0);

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.token.createDialogTitle')}</DialogTitle>
          <DialogDescription>{t('settings.token.createDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field htmlFor={`${idPrefix}-name`} label={t('settings.token.name')} required>
            <Input
              id={`${idPrefix}-name`}
              value={state.name}
              onChange={(event) => onChange({ ...state, name: event.target.value })}
              autoFocus
              required
            />
          </Field>
          <Field
            htmlFor={`${idPrefix}-ip-whitelist`}
            label={t('settings.token.ipWhitelist')}
            hint={t('settings.token.ipWhitelistHint')}
          >
            <textarea
              id={`${idPrefix}-ip-whitelist`}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={state.ipWhitelistRaw}
              onChange={(event) => onChange({ ...state, ipWhitelistRaw: event.target.value })}
              placeholder="10.0.0.0/8&#10;192.168.1.10"
            />
          </Field>
          <Field htmlFor={`${idPrefix}-expires-at`} label={t('settings.token.expiresAt')}>
            <select
              id={`${idPrefix}-expires-at`}
              value={state.expiryPreset}
              onChange={(event) =>
                onChange({
                  ...state,
                  expiryPreset: event.target.value as TokenExpiryPreset,
                  customExpiresAt: event.target.value === 'custom' ? state.customExpiresAt : '',
                })
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="never">{t('settings.token.expiry.never')}</option>
              <option value="7d">{t('settings.token.expiry.7d')}</option>
              <option value="30d">{t('settings.token.expiry.30d')}</option>
              <option value="90d">{t('settings.token.expiry.90d')}</option>
              <option value="custom">{t('settings.token.expiry.custom')}</option>
            </select>
          </Field>
          {state.expiryPreset === 'custom' ? (
            <Field htmlFor={`${idPrefix}-custom-expires-at`} label={t('settings.token.customExpiresAt')} required>
              <Input
                id={`${idPrefix}-custom-expires-at`}
                type="datetime-local"
                value={state.customExpiresAt}
                onChange={(event) => onChange({ ...state, customExpiresAt: event.target.value })}
                required
              />
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={disabled}>
            {pending ? t('settings.token.creating') : t('settings.token.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTokenDialog({
  state,
  pending,
  onChange,
  onCancel,
  onSubmit,
}: {
  state: TokenEditState;
  pending: boolean;
  onChange: (state: TokenEditState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const idPrefix = 'settings-token-edit';
  const disabled =
    pending ||
    state.name.trim().length < 2 ||
    (state.expiryPreset === 'custom' && state.customExpiresAt.trim().length === 0);

  return (
    <Dialog open={state.open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.token.editDialogTitle')}</DialogTitle>
          <DialogDescription>{t('settings.token.editDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field htmlFor={`${idPrefix}-name`} label={t('settings.token.name')} required>
            <Input
              id={`${idPrefix}-name`}
              value={state.name}
              onChange={(event) => onChange({ ...state, name: event.target.value })}
              autoFocus
              required
            />
          </Field>
          <Field htmlFor={`${idPrefix}-expires-at`} label={t('settings.token.expiresAt')}>
            <select
              id={`${idPrefix}-expires-at`}
              value={state.expiryPreset}
              onChange={(event) =>
                onChange({
                  ...state,
                  expiryPreset: event.target.value as TokenExpiryPreset,
                  customExpiresAt: event.target.value === 'custom' ? state.customExpiresAt : '',
                })
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="never">{t('settings.token.expiry.never')}</option>
              <option value="7d">{t('settings.token.expiry.7d')}</option>
              <option value="30d">{t('settings.token.expiry.30d')}</option>
              <option value="90d">{t('settings.token.expiry.90d')}</option>
              <option value="custom">{t('settings.token.expiry.custom')}</option>
            </select>
          </Field>
          {state.expiryPreset === 'custom' ? (
            <Field htmlFor={`${idPrefix}-custom-expires-at`} label={t('settings.token.customExpiresAt')} required>
              <Input
                id={`${idPrefix}-custom-expires-at`}
                type="datetime-local"
                value={state.customExpiresAt}
                onChange={(event) => onChange({ ...state, customExpiresAt: event.target.value })}
                required
              />
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={disabled}>
            {pending ? t('settings.token.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTokenDialog({
  open,
  name,
  prefix,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  name: string;
  prefix: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.token.deleteTitle')}</DialogTitle>
          <DialogDescription>{t('settings.token.deleteDescription')}</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{name}</span>
          <span className="ml-2 font-mono text-xs text-muted-foreground">{maskToken(prefix)}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? t('settings.token.deleting') : t('settings.token.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TokenPlaintextCell({
  prefix,
  plaintext,
  visible,
  revealing,
  onToggle,
  onCopy,
}: {
  prefix: string;
  plaintext?: string;
  visible: boolean;
  revealing: boolean;
  onToggle: () => void;
  onCopy: (plaintext: string) => void;
}) {
  const { t } = useI18n();
  const canCopy = Boolean(plaintext);
  const displayValue = visible && plaintext ? plaintext : maskToken(prefix, plaintext);

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
        aria-label={visible ? t('settings.token.hidePlaintext') : t('settings.token.showPlaintext')}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => plaintext && onCopy(plaintext)}
        disabled={!canCopy}
        aria-label={t('settings.token.copyPlaintext')}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

function PlaintextResult({ title, plaintext, onCopy }: { title: string; plaintext: string; onCopy: () => void }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.token.createdPlaintextHint')}</p>
        </div>
        <Button type="button" variant="outline" onClick={onCopy}>
          <Copy className="mr-2 h-4 w-4" />
          {t('settings.token.copyPlaintext')}
        </Button>
      </div>
      <code className="mt-3 block overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs">
        {plaintext}
      </code>
    </div>
  );
}

function StatusBanner({ tone, children }: { tone: 'success' | 'error'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'success'
          ? 'border-primary/30 bg-primary/5 text-foreground'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
    >
      {children}
    </div>
  );
}
