'use client';

import { Link } from '../../components/navigation/link';
import { useRouter } from '../../hooks/use-router';
import { useEffect, useState } from 'react';
import { ChevronLeft, Copy } from 'lucide-react';
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
  cn,
} from '@proofhound/ui';
import { Main } from '@proofhound/ui/layout';
import { useConnector, useCreateConnector, useUpdateConnector } from '../../hooks';
import { useDelayedLoading } from '../../hooks';
import { useI18n } from '../../i18n';
import { getApiErrorMessage, isCanonicalUuid } from '../../lib';
import type { ConnectorDirection, ConnectorType, CreateConnectorDto } from '@proofhound/shared';

type Mode = 'create' | 'edit';

interface FormState {
  name: string;
  description: string;
  direction: ConnectorDirection;
  type: ConnectorType;
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
  // redis / kafka config
  configMode: 'list' | 'stream';
  configKey: string;
  configConsumerGroup: string;
  configMaxLen: string;
  configTopic: string;
  configFromBeginning: boolean;
  configPartitionKey: string;
  // webhook fields
  ipWhitelistRaw: string;
  webhookMode: 'sync' | 'async';
  webhookTimeoutSeconds: string;
  webhookTargetUrl: string;
  webhookMethod: 'POST' | 'PUT';
}

const EMPTY_STATE: FormState = {
  name: '',
  description: '',
  direction: 'input',
  type: 'redis',
  connectionHost: '',
  connectionPort: '6379',
  connectionUsername: '',
  connectionDefaultDbIndex: '0',
  connectionDeploymentType: 'standalone',
  connectionPassword: '',
  connectionBootstrapBrokers: '',
  connectionSecurityProtocol: 'PLAINTEXT',
  connectionSaslMechanism: '',
  connectionSaslUsername: '',
  connectionSaslPassword: '',
  configMode: 'stream',
  configKey: '',
  configConsumerGroup: '',
  configMaxLen: '',
  configTopic: '',
  configFromBeginning: false,
  configPartitionKey: '',
  ipWhitelistRaw: '',
  webhookMode: 'sync',
  webhookTimeoutSeconds: '30',
  webhookTargetUrl: '',
  webhookMethod: 'POST',
};

export function ConnectorFormPage({
  mode,
  projectId,
  connectorId,
}: {
  mode: Mode;
  projectId: string;
  connectorId?: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const canUseApi =
    isCanonicalUuid(projectId) && (mode === 'create' || (!!connectorId && isCanonicalUuid(connectorId)));
  const existingQuery = useConnector(
    canUseApi && mode === 'edit' ? projectId : '',
    canUseApi && mode === 'edit' ? (connectorId ?? '') : '',
  );
  const createMutation = useCreateConnector(projectId);
  const updateMutation = useUpdateConnector(projectId);

  const [state, setState] = useState<FormState>(EMPTY_STATE);
  const [error, setError] = useState<string | null>(null);
  const [initialTokenPlaintext, setInitialTokenPlaintext] = useState<{ plaintext: string; createdConnectorId: string } | null>(
    null,
  );
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'edit' && existingQuery.data) {
      const c = existingQuery.data;
      const cfg = (c.config as Record<string, unknown>) ?? {};
      const connection = (cfg.connection as Record<string, unknown> | undefined) ?? {};
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate form once when remote data arrives
      setState({
        name: c.name,
        description: c.description ?? '',
        direction: c.direction,
        type: c.type,
        connectionHost: typeof connection.host === 'string' ? connection.host : '',
        connectionPort: connection.port != null ? String(connection.port) : '6379',
        connectionUsername: typeof connection.username === 'string' ? connection.username : '',
        connectionDefaultDbIndex: connection.defaultDbIndex != null ? String(connection.defaultDbIndex) : '0',
        connectionDeploymentType: (connection.deploymentType as FormState['connectionDeploymentType']) ?? 'standalone',
        connectionPassword: '',
        connectionBootstrapBrokers: Array.isArray(connection.bootstrapBrokers)
          ? connection.bootstrapBrokers.filter((item): item is string => typeof item === 'string').join('\n')
          : '',
        connectionSecurityProtocol:
          (connection.securityProtocol as FormState['connectionSecurityProtocol']) ?? 'PLAINTEXT',
        connectionSaslMechanism: (connection.saslMechanism as FormState['connectionSaslMechanism']) ?? '',
        connectionSaslUsername: typeof connection.saslUsername === 'string' ? connection.saslUsername : '',
        connectionSaslPassword: '',
        configMode: (cfg.mode as 'list' | 'stream') ?? 'stream',
        configKey: typeof cfg.key === 'string' ? cfg.key : '',
        configConsumerGroup: c.type === 'kafka' && typeof cfg.consumerGroup === 'string' ? cfg.consumerGroup : '',
        configMaxLen: cfg.maxLen != null ? String(cfg.maxLen) : '',
        configTopic: typeof cfg.topic === 'string' ? cfg.topic : '',
        configFromBeginning: Boolean(cfg.fromBeginning),
        configPartitionKey: typeof cfg.partitionKey === 'string' ? cfg.partitionKey : '',
        ipWhitelistRaw: c.ipWhitelist?.join('\n') ?? '',
        webhookMode: (cfg.webhookMode as 'sync' | 'async') ?? 'sync',
        webhookTimeoutSeconds: cfg.timeoutSeconds != null ? String(cfg.timeoutSeconds) : '30',
        webhookTargetUrl: typeof cfg.targetUrl === 'string' ? cfg.targetUrl : '',
        webhookMethod: (cfg.method as 'POST' | 'PUT') ?? 'POST',
      });
    }
  }, [mode, existingQuery.data]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function buildRedisConnection() {
    return {
      source: 'local_config' as const,
      host: state.connectionHost.trim(),
      port: Number(state.connectionPort),
      username: state.connectionUsername.trim() || null,
      defaultDbIndex: state.connectionDefaultDbIndex.trim() ? Number(state.connectionDefaultDbIndex) : null,
      deploymentType: state.connectionDeploymentType,
    };
  }

  function buildKafkaConnection() {
    return {
      source: 'local_config' as const,
      bootstrapBrokers: state.connectionBootstrapBrokers
        .split(/[\n,]/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
      securityProtocol: state.connectionSecurityProtocol,
      saslMechanism: state.connectionSaslMechanism || null,
      saslUsername: state.connectionSaslUsername.trim() || null,
    };
  }

  function buildCreatePayload(): CreateConnectorDto | null {
    const name = state.name.trim();
    if (name.length < 2) {
      setError('name required');
      return null;
    }
    const description = state.description.trim() || undefined;
    if (state.type === 'redis') {
      const connection = buildRedisConnection();
      const credentials = { password: state.connectionPassword.trim() || undefined };
      if (state.direction === 'input') {
        return {
          type: 'redis',
          direction: 'input',
          name,
          description,
          credentials,
          config: {
            connection,
            mode: state.configMode,
            key: state.configKey.trim(),
          },
        };
      }
      return {
        type: 'redis',
        direction: 'output',
        name,
        description,
        credentials,
        config: {
          connection,
          mode: state.configMode,
          key: state.configKey.trim(),
          maxLen: state.configMaxLen ? Number(state.configMaxLen) : undefined,
        },
      };
    }
    if (state.type === 'kafka') {
      const connection = buildKafkaConnection();
      const credentials = { saslPassword: state.connectionSaslPassword.trim() || undefined };
      if (state.direction === 'input') {
        return {
          type: 'kafka',
          direction: 'input',
          name,
          description,
          credentials,
          config: {
            connection,
            topic: state.configTopic.trim(),
            consumerGroup: state.configConsumerGroup.trim(),
            fromBeginning: state.configFromBeginning || undefined,
          },
        };
      }
      return {
        type: 'kafka',
        direction: 'output',
        name,
        description,
        credentials,
        config: {
          connection,
          topic: state.configTopic.trim(),
          partitionKey: state.configPartitionKey.trim() || undefined,
        },
      };
    }
    // webhook
    const ipWhitelist = state.ipWhitelistRaw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (state.direction === 'input') {
      // The webhook token is auto-issued by the backend on connector creation and written to ph_assets.tokens
      // (scope='webhook'); the frontend no longer selects/binds a user token. See docs/specs/26-connectors.md
      return {
        type: 'webhook',
        direction: 'input',
        name,
        description,
        ipWhitelist: ipWhitelist.length > 0 ? ipWhitelist : undefined,
        config: {
          webhookMode: state.webhookMode,
          timeoutSeconds: state.webhookTimeoutSeconds ? Number(state.webhookTimeoutSeconds) : undefined,
        },
      };
    }
    return {
      type: 'webhook',
      direction: 'output',
      name,
      description,
      config: {
        targetUrl: state.webhookTargetUrl.trim(),
        method: state.webhookMethod,
      },
    };
  }

  async function submit() {
    setError(null);
    try {
      if (mode === 'create') {
        const payload = buildCreatePayload();
        if (!payload) return;
        const created = await createMutation.mutateAsync(payload);
        // When the created connector is a webhook input connector, the backend includes initialWebhookToken plaintext in the response.
        // Show it to the user once (cannot be retrieved again after closing); the user clicks Continue to go to the detail page.
        if (created.initialWebhookToken?.plaintext) {
          setInitialTokenPlaintext({
            plaintext: created.initialWebhookToken.plaintext,
            createdConnectorId: created.id,
          });
          return;
        }
        router.push(`/connectors`);
      } else if (connectorId) {
        // edit only updates name / description / config / ipWhitelist;
        // The webhook token is managed separately in the connector detail page's Webhook Tokens panel.
        const ipWhitelist = state.ipWhitelistRaw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        const body: Record<string, unknown> = {
          name: state.name.trim(),
          description: state.description.trim() === '' ? null : state.description.trim(),
        };
        if (state.type === 'redis') {
          body.config =
            state.direction === 'input'
              ? {
                  mode: state.configMode,
                  key: state.configKey.trim(),
                }
              : {
                  mode: state.configMode,
                  key: state.configKey.trim(),
                  maxLen: state.configMaxLen ? Number(state.configMaxLen) : undefined,
                };
        } else if (state.type === 'kafka') {
          body.config =
            state.direction === 'input'
              ? {
                  topic: state.configTopic.trim(),
                  consumerGroup: state.configConsumerGroup.trim(),
                  fromBeginning: state.configFromBeginning || undefined,
                }
              : { topic: state.configTopic.trim(), partitionKey: state.configPartitionKey.trim() || undefined };
        } else if (state.direction === 'input') {
          body.config = {
            webhookMode: state.webhookMode,
            timeoutSeconds: state.webhookTimeoutSeconds ? Number(state.webhookTimeoutSeconds) : undefined,
          };
          body.ipWhitelist = ipWhitelist.length > 0 ? ipWhitelist : null;
        } else {
          body.config = { targetUrl: state.webhookTargetUrl.trim(), method: state.webhookMethod };
        }
        await updateMutation.mutateAsync({ connectorId, body: body as never });
        router.push(`/connectors/${connectorId}`);
      }
    } catch (err) {
      setError(getApiErrorMessage(err) ?? 'request failed');
    }
  }

  const directionLocked = mode === 'edit';
  const typeLocked = mode === 'edit';

  const isInitialLoading = useDelayedLoading(
    mode === 'edit' && existingQuery.isLoading && !existingQuery.data,
  );

  if (isInitialLoading) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8" data-testid="project-connector-form-page">
          <DetailPageSkeleton />
        </div>
      </Main>
    );
  }

  return (
    <Main className="gap-0 bg-muted/35 p-0">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8" data-testid="project-connector-form-page">
        <div className="mb-4">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/connectors`}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              {t('connectors.title')}
            </Link>
          </Button>
        </div>

        <h1 className="text-2xl font-semibold">
          {mode === 'create' ? t('connectors.newTitle') : t('connectors.editTitle')}
        </h1>

        <form
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* direction */}
          <fieldset className="rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-medium">{t('connectors.section.direction')}</legend>
            <div className="flex gap-2">
              {(['input', 'output'] as ConnectorDirection[]).map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={state.direction === value ? 'default' : 'outline'}
                  disabled={directionLocked}
                  onClick={() => update('direction', value)}
                  data-testid={`project-connector-direction-${value}`}
                >
                  {t(value === 'input' ? 'connectors.direction.input' : 'connectors.direction.output')}
                </Button>
              ))}
            </div>
            {directionLocked && (
              <p className="mt-2 text-xs text-muted-foreground">{t('connectors.form.directionLocked')}</p>
            )}
          </fieldset>

          {/* type */}
          <fieldset className="rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-medium">{t('connectors.section.type')}</legend>
            <div className="flex gap-2">
              {(['redis', 'kafka', 'webhook'] as ConnectorType[]).map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={state.type === value ? 'default' : 'outline'}
                  disabled={typeLocked}
                  onClick={() => update('type', value)}
                  data-testid={`project-connector-type-${value}`}
                >
                  {t(`connectors.type.${value}` as const)}
                </Button>
              ))}
            </div>
            {typeLocked && (
              <p className="mt-2 text-xs text-muted-foreground">{t('connectors.form.typeLocked')}</p>
            )}
          </fieldset>

          {/* name + description */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div>
              <Label htmlFor="connector-name">{t('connectors.form.name')}</Label>
              <Input
                id="connector-name"
                value={state.name}
                onChange={(event) => update('name', event.target.value)}
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('connectors.form.nameHint')}</p>
            </div>
            <div>
              <Label htmlFor="connector-description">{t('connectors.form.description')}</Label>
              <textarea
                id="connector-description"
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={state.description}
                onChange={(event) => update('description', event.target.value)}
              />
            </div>
          </div>

          {/* redis/kafka branch: connection + config */}
          {(state.type === 'redis' || state.type === 'kafka') && (
            <fieldset className="rounded-lg border bg-card p-4 space-y-3">
              <legend className="px-1 text-sm font-medium">{t('connectors.section.config')}</legend>

              {state.type === 'redis' ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>{t('connectors.form.config.host')}</Label>
                    <Input
                      value={state.connectionHost}
                      onChange={(event) => update('connectionHost', event.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>{t('connectors.form.config.port')}</Label>
                    <Input
                      type="number"
                      value={state.connectionPort}
                      onChange={(event) => update('connectionPort', event.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>{t('connectors.form.config.deploymentType')}</Label>
                    <select
                      value={state.connectionDeploymentType}
                      onChange={(event) =>
                        update('connectionDeploymentType', event.target.value as FormState['connectionDeploymentType'])
                      }
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-70"
                    >
                      <option value="standalone">standalone</option>
                      <option value="sentinel">sentinel</option>
                      <option value="cluster">cluster</option>
                    </select>
                  </div>
                  <div>
                    <Label>{t('connectors.form.config.defaultDbIndex')}</Label>
                    <Input
                      type="number"
                      value={state.connectionDefaultDbIndex}
                      onChange={(event) => update('connectionDefaultDbIndex', event.target.value)}
                    />
                  </div>
                  <div>
                    <Label>{t('connectors.form.config.username')}</Label>
                    <Input
                      value={state.connectionUsername}
                      onChange={(event) => update('connectionUsername', event.target.value)}
                    />
                  </div>
                  <div>
                    <Label>{t('connectors.form.config.password')}</Label>
                    <Input
                      type="password"
                      value={state.connectionPassword}
                      onChange={(event) => update('connectionPassword', event.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label>{t('connectors.form.config.bootstrapBrokers')}</Label>
                    <textarea
                      rows={3}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-70"
                      value={state.connectionBootstrapBrokers}
                      onChange={(event) => update('connectionBootstrapBrokers', event.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <Label>{t('connectors.form.config.securityProtocol')}</Label>
                      <select
                        value={state.connectionSecurityProtocol}
                        onChange={(event) =>
                          update(
                            'connectionSecurityProtocol',
                            event.target.value as FormState['connectionSecurityProtocol'],
                          )
                        }
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-70"
                      >
                        <option value="PLAINTEXT">PLAINTEXT</option>
                        <option value="SSL">SSL</option>
                        <option value="SASL_PLAINTEXT">SASL_PLAINTEXT</option>
                        <option value="SASL_SSL">SASL_SSL</option>
                      </select>
                    </div>
                    <div>
                      <Label>{t('connectors.form.config.saslMechanism')}</Label>
                      <select
                        value={state.connectionSaslMechanism}
                        onChange={(event) =>
                          update('connectionSaslMechanism', event.target.value as FormState['connectionSaslMechanism'])
                        }
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-70"
                      >
                        <option value="">-</option>
                        <option value="PLAIN">PLAIN</option>
                        <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                        <option value="SCRAM-SHA-512">SCRAM-SHA-512</option>
                      </select>
                    </div>
                    <div>
                      <Label>{t('connectors.form.config.saslUsername')}</Label>
                      <Input
                        value={state.connectionSaslUsername}
                        onChange={(event) => update('connectionSaslUsername', event.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>{t('connectors.form.config.saslPassword')}</Label>
                    <Input
                      type="password"
                      value={state.connectionSaslPassword}
                      onChange={(event) => update('connectionSaslPassword', event.target.value)}
                    />
                  </div>
                </div>
              )}

              {state.type === 'redis' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t('connectors.form.config.mode')}</Label>
                      <SlidingViewToggle
                        value={state.configMode}
                        options={[
                          { value: 'stream', label: t('connectors.redisMode.stream') },
                          { value: 'list', label: t('connectors.redisMode.list') },
                        ]}
                        ariaLabel={t('connectors.form.config.mode')}
                        onChange={(value) => update('configMode', value)}
                        className="mt-1 w-full"
                      />
                    </div>
                    <div>
                      <Label>{t('connectors.form.config.key')}</Label>
                      <Input
                        value={state.configKey}
                        onChange={(event) => update('configKey', event.target.value)}
                        required
                      />
                    </div>
                  </div>
                  {state.direction === 'output' && (
                    <div>
                      <Label>{t('connectors.form.config.maxLen')}</Label>
                      <Input
                        type="number"
                        value={state.configMaxLen}
                        onChange={(event) => update('configMaxLen', event.target.value)}
                      />
                    </div>
                  )}
                </>
              )}

              {state.type === 'kafka' && (
                <>
                  <div>
                    <Label>{t('connectors.form.config.topic')}</Label>
                    <Input
                      value={state.configTopic}
                      onChange={(event) => update('configTopic', event.target.value)}
                      required
                    />
                  </div>
                  {state.direction === 'input' && (
                    <>
                      <div>
                        <Label>{t('connectors.form.config.consumerGroup')}</Label>
                        <Input
                          value={state.configConsumerGroup}
                          onChange={(event) => update('configConsumerGroup', event.target.value)}
                          required
                        />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 cursor-pointer accent-primary"
                          checked={state.configFromBeginning}
                          onChange={(event) => update('configFromBeginning', event.target.checked)}
                        />
                        {t('connectors.form.config.fromBeginning')}
                      </label>
                    </>
                  )}
                  {state.direction === 'output' && (
                    <div>
                      <Label>{t('connectors.form.config.partitionKey')}</Label>
                      <Input
                        value={state.configPartitionKey}
                        onChange={(event) => update('configPartitionKey', event.target.value)}
                      />
                    </div>
                  )}
                </>
              )}
            </fieldset>
          )}

          {/* webhook branch */}
          {state.type === 'webhook' && (
            <fieldset
              className={cn('rounded-lg border bg-card p-4 space-y-3')}
              data-testid="project-connector-webhook-fieldset"
            >
              <legend className="px-1 text-sm font-medium">{t('connectors.section.webhook')}</legend>
              {state.direction === 'input' && (
                <>
                  {mode === 'create' ? (
                    <p
                      className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground"
                      data-testid="project-connector-webhook-token-hint"
                    >
                      {t('connectors.form.webhook.tokenAutoCreated')}
                    </p>
                  ) : null}
                  <div>
                    <Label>{t('connectors.form.webhook.ipWhitelist')}</Label>
                    <textarea
                      rows={3}
                      className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                      value={state.ipWhitelistRaw}
                      onChange={(event) => update('ipWhitelistRaw', event.target.value)}
                      placeholder="10.0.0.0/8&#10;192.168.1.0/24"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t('connectors.form.webhook.mode')}</Label>
                      <select
                        value={state.webhookMode}
                        onChange={(event) => update('webhookMode', event.target.value as 'sync' | 'async')}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      >
                        <option value="sync">{t('connectors.form.webhook.modeSync')}</option>
                        <option value="async">{t('connectors.form.webhook.modeAsync')}</option>
                      </select>
                    </div>
                    <div>
                      <Label>{t('connectors.form.webhook.timeoutSeconds')}</Label>
                      <Input
                        type="number"
                        value={state.webhookTimeoutSeconds}
                        onChange={(event) => update('webhookTimeoutSeconds', event.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
              {state.direction === 'output' && (
                <>
                  <div>
                    <Label>{t('connectors.form.webhook.targetUrl')}</Label>
                    <Input
                      value={state.webhookTargetUrl}
                      onChange={(event) => update('webhookTargetUrl', event.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>{t('connectors.form.webhook.method')}</Label>
                    <select
                      value={state.webhookMethod}
                      onChange={(event) => update('webhookMethod', event.target.value as 'POST' | 'PUT')}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                    </select>
                  </div>
                </>
              )}
            </fieldset>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => router.push(`/connectors`)}>
              {t('connectors.form.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="project-connector-submit"
            >
              {createMutation.isPending || updateMutation.isPending
                ? t('connectors.form.submitting')
                : t('connectors.form.submit')}
            </Button>
          </div>
        </form>

        <Dialog
          open={!!initialTokenPlaintext}
          onOpenChange={(open) => {
            if (!open && initialTokenPlaintext) {
              const targetId = initialTokenPlaintext.createdConnectorId;
              setInitialTokenPlaintext(null);
              setCopyNotice(null);
              router.push(`/connectors/${targetId}`);
            }
          }}
        >
          <DialogContent data-testid="project-connector-initial-token-dialog">
            <DialogHeader>
              <DialogTitle>{t('connectors.token.initialTitle')}</DialogTitle>
              <DialogDescription>{t('connectors.token.initialHint')}</DialogDescription>
            </DialogHeader>
            {initialTokenPlaintext ? (
              <div className="space-y-3">
                <code
                  className="block overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs"
                  data-testid="project-connector-initial-token-value"
                >
                  {initialTokenPlaintext.plaintext}
                </code>
                {copyNotice ? (
                  <p className="text-xs text-muted-foreground">{copyNotice}</p>
                ) : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  if (!initialTokenPlaintext) return;
                  try {
                    await navigator.clipboard.writeText(initialTokenPlaintext.plaintext);
                    setCopyNotice(t('connectors.detail.copied'));
                  } catch {
                    setCopyNotice(t('connectors.token.copyFailed'));
                  }
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                {t('connectors.token.copy')}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!initialTokenPlaintext) return;
                  const targetId = initialTokenPlaintext.createdConnectorId;
                  setInitialTokenPlaintext(null);
                  setCopyNotice(null);
                  router.push(`/connectors/${targetId}`);
                }}
              >
                {t('connectors.token.initialContinue')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Main>
  );
}
