// Connector business service
// See docs/specs/26-connectors.md §3 / §7 occupancy and deletion constraints
// The inbound webhook token is self-managed by this module: create automatically generates the first token,
// subsequently managed via listWebhookTokens / createWebhookToken / revokeWebhookToken.
// See docs/specs/06-database-schema.md §3.2 / §4.5
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type {
  BulkDeleteConnectorRejectionDto,
  BulkDeleteConnectorsRequestDto,
  BulkDeleteConnectorsResponseDto,
  ConnectorConfigShape,
  ConnectorCreateResponseDto,
  ConnectorDeleteQueryDto,
  ConnectorDetailDto,
  ConnectorListItemDto,
  ConnectorListQueryDto,
  ConnectorListResponseDto,
  ConnectorReferencesResponseDto,
  ConnectorReferencesSummaryDto,
  ConnectorWebhookTokenListDto,
  ConnectorWebhookTokenSummaryDto,
  CreateConnectorDto,
  CreateWebhookTokenDto,
  CreateWebhookTokenResponseDto,
  RevealWebhookTokenResponseDto,
  KafkaConnectionConfig,
  PeekConnectorRequestDto,
  PeekConnectorMessageDto,
  PeekConnectorResponseDto,
  ProbeConnectorResponseDto,
  ProjectContext,
  RedisConnectionConfig,
  UpdateConnectorDto,
} from '@proofhound/shared';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import { WorkflowAuthorizationHook } from '../../common/contracts/workflow-authorization.hook';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CryptoService } from '../../../shared/crypto/crypto.service';
import { ConnectorDriverFactory } from './connector.driver-factory';
import {
  ConnectorRepository,
  type ConnectorInsertRow,
  type ConnectorProjectAccessRow,
  type ConnectorRowWithJoins,
  type WebhookTokenRow,
} from './connector.repository';

type ActionSource = 'api' | 'mcp';

const EMPTY_REFERENCES: ConnectorReferencesSummaryDto = Object.freeze({
  canaryReleases: 0,
  productionReleases: 0,
});
const MAX_PEEK_SCHEMA_DEPTH = 6;
const MAX_PEEK_SCHEMA_PROPERTIES = 200;
const DEFAULT_INITIAL_WEBHOOK_TOKEN_NAME = 'Auto-generated webhook token';

interface BrokerEncryptedConfig {
  password?: string;
  saslPassword?: string;
  bootstrapBrokers?: string[];
  securityProtocol?: KafkaConnectionConfig['securityProtocol'];
  saslMechanism?: KafkaConnectionConfig['saslMechanism'];
  saslUsername?: string | null;
}

interface InitialWebhookTokenSecret {
  id: string;
  name: string;
  prefix: string;
  plaintext: string;
  expiresAt: Date | null;
}

@Injectable()
export class ConnectorService {
  private readonly logger = createLogger('connector.service', { service: 'server' });

  constructor(
    private readonly repo: ConnectorRepository,
    private readonly driverFactory: ConnectorDriverFactory,
    private readonly crypto: CryptoService,
    private readonly accessControl: AccessControlService,
    private readonly workflowAuth: WorkflowAuthorizationHook,
  ) {}

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------
  async list(
    projectId: string,
    actor: CurrentUserPayload,
    query?: ConnectorListQueryDto,
  ): Promise<ConnectorListResponseDto> {
    await this.getAccessibleProject(projectId, actor);
    const rows = await this.repo.listByProject(projectId, query);
    const filtered = this.applySearch(rows, query?.search);
    const references = await this.repo.countReferences(filtered.map((row) => row.id));
    const tokenCounts = await this.repo.countActiveWebhookTokensByConnectorIds(filtered.map((row) => row.id));
    const data = filtered.map((row) =>
      this.toListItem(row, references.get(row.id) ?? this.cloneEmptyReferences(), tokenCounts.get(row.id) ?? 0),
    );
    return { data, total: data.length };
  }

  async getDetail(projectId: string, connectorId: string, actor: CurrentUserPayload): Promise<ConnectorDetailDto> {
    await this.getAccessibleProject(projectId, actor);
    const row = await this.repo.findById(projectId, connectorId);
    if (!row) throw new NotFoundException(`Connector ${connectorId} not found`);
    const counts = await this.repo.countReferences([row.id]);
    const tokens = await this.loadWebhookTokenSummaries(row);
    return this.toDetail(row, counts.get(row.id) ?? this.cloneEmptyReferences(), tokens);
  }

  async getReferences(
    projectId: string,
    connectorId: string,
    actor: CurrentUserPayload,
  ): Promise<ConnectorReferencesResponseDto> {
    await this.getAccessibleProject(projectId, actor);
    const row = await this.repo.findById(projectId, connectorId);
    if (!row) throw new NotFoundException(`Connector ${connectorId} not found`);
    const summary = (await this.repo.countReferences([row.id])).get(row.id) ?? this.cloneEmptyReferences();
    const references = await this.repo.listReferenceDetails(connectorId);
    return { summary, references };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------
  async create(
    projectId: string,
    dto: CreateConnectorDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<ConnectorCreateResponseDto> {
    void source;
    await this.getWritableProject(projectId, actor);
    await this.assertNameAvailable(projectId, dto.name);

    const id = randomUUID();
    const insert = this.buildInsertRow(id, projectId, dto, actor.sub);

    const created = await this.repo.insert(insert);

    // Webhook input connectors auto-generate the first webhook token on creation
    let initialWebhookToken: InitialWebhookTokenSecret | null = null;
    if (dto.type === 'webhook' && dto.direction === 'input') {
      initialWebhookToken = await this.generateInitialWebhookToken(created.id, projectId, actor.sub);
    }

    const detail = await this.getDetail(projectId, created.id, actor);
    if (!initialWebhookToken) return detail;
    return {
      ...detail,
      initialWebhookToken: {
        id: initialWebhookToken.id,
        name: initialWebhookToken.name,
        prefix: initialWebhookToken.prefix,
        plaintext: initialWebhookToken.plaintext,
        expiresAt: initialWebhookToken.expiresAt?.toISOString() ?? null,
      },
    };
  }

  async update(
    projectId: string,
    connectorId: string,
    dto: UpdateConnectorDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<ConnectorDetailDto> {
    void source;
    await this.getWritableProject(projectId, actor);
    const existing = await this.repo.findById(projectId, connectorId);
    if (!existing) throw new NotFoundException(`Connector ${connectorId} not found`);

    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(projectId, dto.name, connectorId);
    }

    const patch: Partial<ConnectorInsertRow> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description ?? null;
    if (dto.config !== undefined) {
      this.assertConfigShape(existing.type, existing.direction, dto.config);
      patch.config = this.mergePersistentConfig(existing.config, dto.config);
    }
    if (dto.credentials !== undefined) {
      const credentialType = existing.type === 'redis' || existing.type === 'kafka' ? existing.type : null;
      if (!credentialType) {
        throw new BadRequestException('credentials apply only to redis / kafka connectors');
      }
      const configEncrypted = this.buildUpdatedProjectConnectorEncryptedConfig(
        existing.configEncrypted,
        credentialType,
        dto.credentials,
      );
      if (configEncrypted !== undefined) patch.configEncrypted = configEncrypted;
    }
    // ipWhitelist is only allowed for the webhook type
    if (dto.ipWhitelist !== undefined) {
      if (existing.type !== 'webhook') {
        throw new BadRequestException('ipWhitelist applies only to webhook connectors');
      }
      patch.ipWhitelist = dto.ipWhitelist;
    }
    // dto.tokenId is deprecated: webhook tokens are managed via createWebhookToken / revokeWebhookToken.
    // Silently ignored here to keep the legacy frontend form working during the transition.
    if (dto.tokenId !== undefined) {
      this.logger.warn(
        { connectorId, projectId, tokenId: dto.tokenId },
        'connector_update_tokenId_ignored_deprecated',
      );
    }

    await this.repo.update(projectId, connectorId, patch);
    return this.getDetail(projectId, connectorId, actor);
  }

  async delete(
    projectId: string,
    connectorId: string,
    query: ConnectorDeleteQueryDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<void> {
    void source;
    await this.getWritableProject(projectId, actor);
    const existing = await this.repo.findById(projectId, connectorId);
    if (!existing) throw new NotFoundException(`Connector ${connectorId} not found`);

    const force = query.force ?? false;
    if (!force) {
      const counts = (await this.repo.countReferences([connectorId])).get(connectorId) ?? this.cloneEmptyReferences();
      const total = counts.canaryReleases + counts.productionReleases;
      if (total > 0) {
        throw new ConflictException(`connector_referenced:${total}`);
      }
    }
    await this.repo.softDelete(projectId, connectorId);
  }

  async bulkDelete(
    projectId: string,
    dto: BulkDeleteConnectorsRequestDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<BulkDeleteConnectorsResponseDto> {
    void source;
    await this.getWritableProject(projectId, actor);
    const force = dto.force ?? false;
    const deletedIds: string[] = [];
    const rejected: BulkDeleteConnectorRejectionDto[] = [];

    const rows = await this.repo.findManyByIds(projectId, dto.ids);
    const found = new Map(rows.map((row) => [row.id, row]));
    const refMap = await this.repo.countReferences(dto.ids);

    for (const id of dto.ids) {
      const row = found.get(id);
      if (!row) {
        rejected.push({ id, reason: 'not_found' });
        continue;
      }
      const refs = refMap.get(id) ?? this.cloneEmptyReferences();
      const totalRefs = refs.canaryReleases + refs.productionReleases;
      if (!force && totalRefs > 0) {
        rejected.push({ id, reason: 'connector_referenced', referencedBy: refs });
        continue;
      }
      await this.repo.softDelete(projectId, id);
      deletedIds.push(id);
    }

    return { deletedIds, rejected };
  }

  // -------------------------------------------------------------------------
  // webhook token: list / create / revoke
  // -------------------------------------------------------------------------
  async listWebhookTokens(
    projectId: string,
    connectorId: string,
    actor: CurrentUserPayload,
  ): Promise<ConnectorWebhookTokenListDto> {
    await this.getAccessibleProject(projectId, actor);
    const row = await this.repo.findById(projectId, connectorId);
    if (!row) throw new NotFoundException(`Connector ${connectorId} not found`);
    const tokens = await this.repo.listWebhookTokensForConnector(connectorId);
    const data = tokens.map((token) => this.toWebhookTokenSummary(token));
    return { data, total: data.length };
  }

  async createWebhookToken(
    projectId: string,
    connectorId: string,
    dto: CreateWebhookTokenDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<CreateWebhookTokenResponseDto> {
    void source;
    await this.getWritableProject(projectId, actor);
    const row = await this.repo.findById(projectId, connectorId);
    if (!row) throw new NotFoundException(`Connector ${connectorId} not found`);
    if (row.type !== 'webhook' || row.direction !== 'input') {
      throw new BadRequestException('webhook tokens apply only to webhook input connectors');
    }
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const plaintext = this.generateWebhookTokenPlaintext();
    const tokenHash = this.hashToken(plaintext);
    const prefix = plaintext.slice(0, 12);
    const name = dto.name?.trim() && dto.name.trim().length > 0 ? dto.name.trim() : DEFAULT_INITIAL_WEBHOOK_TOKEN_NAME;
    const inserted = await this.repo.insertWebhookToken({
      connectorId,
      projectId,
      name,
      tokenHash,
      tokenEncrypted: this.crypto.encryptApiKey(plaintext),
      prefix,
      expiresAt,
      createdBy: actor.sub,
    });
    return {
      id: inserted.id,
      name,
      prefix,
      plaintext,
      expiresAt: expiresAt?.toISOString() ?? null,
    };
  }

  async revokeWebhookToken(
    projectId: string,
    connectorId: string,
    tokenId: string,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<void> {
    void source;
    await this.getWritableProject(projectId, actor);
    const row = await this.repo.findById(projectId, connectorId);
    if (!row) throw new NotFoundException(`Connector ${connectorId} not found`);
    const token = await this.repo.findWebhookTokenById(connectorId, tokenId);
    if (!token) throw new NotFoundException(`webhook token ${tokenId} not found`);
    const revoked = await this.repo.revokeWebhookToken(connectorId, tokenId);
    if (!revoked) throw new NotFoundException(`webhook token ${tokenId} not found`);
    const remaining = await this.repo.countActiveWebhookTokens(connectorId);
    if (remaining === 0) {
      this.logger.warn(
        { projectId, connectorId, tokenId },
        'connector_webhook_token_revoke_left_zero_active_tokens',
      );
    }
  }

  // Aligned with token.service's revealApiToken / revealGlobalMcpToken:
  // decrypt from token_encrypted and return the plaintext, allowing the local admin console to reveal multiple times (SPEC 06 §3.2).
  async revealWebhookToken(
    projectId: string,
    connectorId: string,
    tokenId: string,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<RevealWebhookTokenResponseDto> {
    void source;
    await this.getWritableProject(projectId, actor);
    const row = await this.repo.findById(projectId, connectorId);
    if (!row) throw new NotFoundException(`Connector ${connectorId} not found`);
    const token = await this.repo.findWebhookTokenWithEncryptedById(connectorId, tokenId);
    if (!token) throw new NotFoundException(`webhook token ${tokenId} not found`);
    const plaintext = token.tokenEncrypted ? this.crypto.decryptApiKey(token.tokenEncrypted) : null;
    return { tokenId, plaintext, available: Boolean(plaintext) };
  }

  // -------------------------------------------------------------------------
  // probe / peek (driver)
  // -------------------------------------------------------------------------
  async probe(
    projectId: string,
    connectorId: string,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
    orgId?: string,
  ): Promise<ProbeConnectorResponseDto> {
    void source;
    await this.getAccessibleProject(projectId, actor);
    const row = await this.repo.findById(projectId, connectorId);
    if (!row) throw new NotFoundException(`Connector ${connectorId} not found`);
    await this.assertProbeWorkflowStart(projectId, actor, orgId);

    const startedAt = Date.now();
    const driverResult = await this.driverFactory.probe({
      configEncrypted: row.configEncrypted,
      type: row.type as 'redis' | 'kafka' | 'webhook',
      direction: row.direction as 'input' | 'output',
      config: (row.config ?? {}) as Parameters<ConnectorDriverFactory['probe']>[0]['config'],
    });
    const error = driverResult.error;
    const probedAt = new Date();
    const durationMs = Math.max(1, Date.now() - startedAt);
    await this.repo.updateProbeOutcome(projectId, connectorId, probedAt, error);

    return {
      connectorId,
      status: error ? 'failed' : 'success',
      probedAt: probedAt.toISOString(),
      durationMs,
      error,
    };
  }

  async peek(
    projectId: string,
    connectorId: string,
    body: PeekConnectorRequestDto,
    actor: CurrentUserPayload,
    source: ActionSource = 'api',
  ): Promise<PeekConnectorResponseDto> {
    void source;
    await this.getAccessibleProject(projectId, actor);
    const row = await this.repo.findById(projectId, connectorId);
    if (!row) throw new NotFoundException(`Connector ${connectorId} not found`);
    if (row.direction !== 'input') {
      throw new BadRequestException('peek_not_supported_for_output');
    }

    const limit = body.limit ?? 5;
    const config = (row.config ?? {}) as Parameters<ConnectorDriverFactory['peek']>[0]['config'];
    const driverResult = await this.driverFactory.peek({
      configEncrypted: row.configEncrypted,
      type: row.type as 'redis' | 'kafka' | 'webhook',
      direction: 'input',
      config,
      limit,
    });

    const fetchedAt = new Date().toISOString();
    const persistedMessages = driverResult.error ? [] : driverResult.messages;
    const payloadSchema = this.inferPeekPayloadSchema(persistedMessages);
    if (row.type === 'redis' || row.type === 'kafka') {
      await this.repo.update(projectId, connectorId, {
        config: this.withLatestPeekMetadata(
          config,
          payloadSchema,
          persistedMessages[0] ?? null,
          fetchedAt,
          persistedMessages.length,
        ),
        healthStatus: driverResult.error ? 'unhealthy' : 'healthy',
        lastProbedAt: new Date(fetchedAt),
        lastProbeError: driverResult.error,
      });
    }

    return {
      connectorId,
      source: driverResult.source,
      messages: persistedMessages,
      payloadSchema,
      fetchedAt,
      error: driverResult.error,
    };
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------
  private async generateInitialWebhookToken(
    connectorId: string,
    projectId: string,
    createdBy: string,
  ): Promise<InitialWebhookTokenSecret> {
    const plaintext = this.generateWebhookTokenPlaintext();
    const tokenHash = this.hashToken(plaintext);
    const prefix = plaintext.slice(0, 12);
    const name = DEFAULT_INITIAL_WEBHOOK_TOKEN_NAME;
    const inserted = await this.repo.insertWebhookToken({
      connectorId,
      projectId,
      name,
      tokenHash,
      tokenEncrypted: this.crypto.encryptApiKey(plaintext),
      prefix,
      expiresAt: null,
      createdBy,
    });
    return { id: inserted.id, name, prefix, plaintext, expiresAt: null };
  }

  private generateWebhookTokenPlaintext(): string {
    return `ph_wh_${randomBytes(24).toString('base64url')}`;
  }

  private hashToken(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  private async assertProbeWorkflowStart(projectId: string, actor: CurrentUserPayload, orgId?: string): Promise<void> {
    const project: ProjectContext = orgId ? { projectId, orgId, source: 'local' } : { projectId, source: 'local' };
    await this.workflowAuth.assertCanStart(toActorContext(actor), project, 'probe');
  }

  private async loadWebhookTokenSummaries(row: ConnectorRowWithJoins): Promise<ConnectorWebhookTokenSummaryDto[]> {
    if (row.type !== 'webhook' || row.direction !== 'input') return [];
    const tokens = await this.repo.listWebhookTokensForConnector(row.id);
    return tokens.map((token) => this.toWebhookTokenSummary(token));
  }

  private toWebhookTokenSummary(token: WebhookTokenRow): ConnectorWebhookTokenSummaryDto {
    return {
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      expiresAt: token.expiresAt?.toISOString() ?? null,
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      createdAt: token.createdAt.toISOString(),
    };
  }

  private withLatestPeekMetadata(
    config: unknown,
    payloadSchema: Record<string, unknown> | null,
    latestMessage: PeekConnectorMessageDto | null,
    fetchedAt: string,
    messageCount: number,
  ): Record<string, unknown> {
    const base = this.isRecord(config) ? { ...config } : {};
    return {
      ...base,
      lastPeekPayloadSchema: payloadSchema,
      lastPeekMessage: latestMessage,
      lastPeekedAt: fetchedAt,
      lastPeekMessageCount: messageCount,
    };
  }

  private inferPeekPayloadSchema(messages: PeekConnectorMessageDto[]): Record<string, unknown> | null {
    if (messages.length === 0) return null;
    return this.mergeValueSchemas(messages.map((message) => this.inferValueSchema(message.payload)));
  }

  private inferValueSchema(value: unknown, depth = 0): Record<string, unknown> {
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) {
      const itemSchemas = value
        .slice(0, MAX_PEEK_SCHEMA_PROPERTIES)
        .map((item) => this.inferValueSchema(item, depth + 1));
      return itemSchemas.length > 0 ? { type: 'array', items: this.mergeValueSchemas(itemSchemas) } : { type: 'array' };
    }

    const valueType = typeof value;
    if (valueType === 'string') return { type: 'string' };
    if (valueType === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
    if (valueType === 'boolean') return { type: 'boolean' };
    if (valueType !== 'object' || !this.isRecord(value)) return { type: 'unknown' };

    if (depth >= MAX_PEEK_SCHEMA_DEPTH) return { type: 'object' };

    const properties: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(0, MAX_PEEK_SCHEMA_PROPERTIES)) {
      properties[key] = this.inferValueSchema(child, depth + 1);
    }
    return { type: 'object', properties };
  }

  private mergeValueSchemas(schemas: Record<string, unknown>[]): Record<string, unknown> {
    const nonNullSchemas = schemas.filter((schema) => schema.type !== 'null');
    if (nonNullSchemas.length === 0) return { type: 'null' };

    const normalizedTypes = new Set(nonNullSchemas.map((schema) => schema.type));
    if (normalizedTypes.has('number') && normalizedTypes.has('integer')) {
      normalizedTypes.delete('integer');
    }
    if (normalizedTypes.size > 1) return { type: 'unknown' };

    const [type] = Array.from(normalizedTypes);
    if (type === 'object') {
      return { type: 'object', properties: this.mergeObjectProperties(nonNullSchemas) };
    }
    if (type === 'array') {
      const itemSchemas = nonNullSchemas
        .map((schema) => schema.items)
        .filter((item): item is Record<string, unknown> => this.isRecord(item));
      return itemSchemas.length > 0 ? { type: 'array', items: this.mergeValueSchemas(itemSchemas) } : { type: 'array' };
    }
    return { type: type === 'number' ? 'number' : String(type ?? 'unknown') };
  }

  private mergeObjectProperties(schemas: Record<string, unknown>[]): Record<string, unknown> {
    const keys = new Set<string>();
    const propertyMaps = schemas.map((schema) => (this.isRecord(schema.properties) ? schema.properties : {}));
    for (const properties of propertyMaps) {
      for (const key of Object.keys(properties)) keys.add(key);
    }

    const merged: Record<string, unknown> = {};
    for (const key of keys) {
      const childSchemas = propertyMaps
        .map((properties) => properties[key])
        .filter((value): value is Record<string, unknown> => this.isRecord(value));
      if (childSchemas.length > 0) merged[key] = this.mergeValueSchemas(childSchemas);
    }
    return merged;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private cloneEmptyReferences(): ConnectorReferencesSummaryDto {
    return { ...EMPTY_REFERENCES };
  }

  private async getAccessibleProject(projectId: string, actor: CurrentUserPayload): Promise<ConnectorProjectAccessRow> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const project = await this.repo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!project) throw new NotFoundException(`Workspace ${projectId} not found`);
    return project;
  }

  private async getWritableProject(projectId: string, actor: CurrentUserPayload): Promise<ConnectorProjectAccessRow> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_write');
    return this.getAccessibleProject(projectId, actor);
  }

  private async assertNameAvailable(projectId: string, name: string, excludeId?: string): Promise<void> {
    const existing = await this.repo.findByProjectAndName(projectId, name, excludeId);
    if (existing) throw new ConflictException(`connector_name_in_use:${name}`);
  }

  private buildInsertRow(
    id: string,
    projectId: string,
    dto: CreateConnectorDto,
    createdBy: string,
  ): ConnectorInsertRow {
    const base = {
      id,
      projectId,
      name: dto.name,
      description: dto.description ?? null,
      direction: dto.direction,
      type: dto.type,
      healthStatus: 'unknown',
      lastProbedAt: null,
      lastProbeError: null,
      createdBy,
    } satisfies Partial<ConnectorInsertRow>;

    if (dto.type === 'redis' || dto.type === 'kafka') {
      const config = dto.config;
      this.assertProjectConnectionConfigured(dto.type, config);
      return {
        ...base,
        config,
        configEncrypted: this.buildProjectConnectorEncryptedConfig(dto),
        webhookPath: null,
        ipWhitelist: null,
      };
    }

    // Webhook branch
    if (dto.direction === 'input') {
      // Note: generating webhookPath asynchronously in the service layer would introduce nested async, so we use synchronous allocation.
      // Since the collision probability of randomUUID is ~0, generate it directly; if a collision really happens, the DB unique index will reject it.
      return {
        ...base,
        configEncrypted: null,
        config: dto.config,
        webhookPath: randomUUID(),
        ipWhitelist: dto.ipWhitelist ?? null,
      };
    }
    // Webhook output: no path / token needed; only targetUrl is recorded in config
    return {
      ...base,
      configEncrypted: null,
      config: dto.config,
      webhookPath: null,
      ipWhitelist: null,
    };
  }

  private assertProjectConnectionConfigured(type: 'redis' | 'kafka', config: ConnectorConfigShape): void {
    const record: Record<string, unknown> | null = this.isRecord(config) ? config : null;
    const rawConnection = record?.['connection'];
    const connection = this.isRecord(rawConnection) ? rawConnection : null;
    if (!connection) {
      throw new BadRequestException(
        `${type} connector requires local connection config`,
      );
    }
    if (type === 'redis') {
      if (!connection.host) throw new BadRequestException('redis connector connection.host is required');
      if (!connection.port) throw new BadRequestException('redis connector connection.port is required');
      return;
    }
    const bootstrapBrokers = connection.bootstrapBrokers;
    if (!Array.isArray(bootstrapBrokers) || bootstrapBrokers.length === 0) {
      throw new BadRequestException('kafka connector connection.bootstrapBrokers is required');
    }
  }

  private buildProjectConnectorEncryptedConfig(
    dto: Extract<CreateConnectorDto, { type: 'redis' | 'kafka' }>,
  ): string | null {
    if (dto.type === 'redis') {
      const password = dto.credentials?.password;
      return password ? this.encryptBrokerConfig({ password }) : null;
    }

    const saslPassword = dto.credentials?.saslPassword;
    return saslPassword ? this.encryptBrokerConfig({ saslPassword }) : null;
  }

  private buildUpdatedProjectConnectorEncryptedConfig(
    existingEncrypted: unknown,
    type: 'redis' | 'kafka',
    credentials: NonNullable<UpdateConnectorDto['credentials']>,
  ): string | null | undefined {
    const existing = this.decryptBrokerConfig(existingEncrypted);
    if (type === 'redis') {
      if (!('password' in credentials) || !credentials.password) return undefined;
      return this.encryptBrokerConfig({ ...existing, password: credentials.password });
    }
    if (!('saslPassword' in credentials) || !credentials.saslPassword) return undefined;
    return this.encryptBrokerConfig({ ...existing, saslPassword: credentials.saslPassword });
  }

  private mergePersistentConfig(existing: unknown, next: ConnectorConfigShape): ConnectorConfigShape {
    if (!this.isRecord(existing) || !this.isRecord(next)) return next;
    const merged: Record<string, unknown> = { ...next };
    if (!this.isRecord(merged.connection) && this.isRecord(existing.connection)) {
      merged.connection = existing.connection;
    }
    return merged as ConnectorConfigShape;
  }

  private encryptBrokerConfig(value: BrokerEncryptedConfig): string {
    return this.crypto.encryptApiKey(JSON.stringify(value));
  }

  private decryptBrokerConfig(payload: unknown): BrokerEncryptedConfig {
    if (typeof payload === 'string') {
      try {
        const plain = this.crypto.decryptApiKey(payload);
        const parsed = JSON.parse(plain);
        if (parsed && typeof parsed === 'object') return parsed as BrokerEncryptedConfig;
      } catch (error) {
        this.logger.warn({ msg: 'decrypt_connector_broker_config_failed', error: (error as Error).message });
      }
      return {};
    }
    if (payload && typeof payload === 'object') return payload as BrokerEncryptedConfig;
    return {};
  }

  private assertConfigShape(type: string, direction: string, _config: unknown): void {
    if (!['redis', 'kafka', 'webhook'].includes(type)) {
      throw new BadRequestException(`invalid connector type: ${type}`);
    }
    if (!['input', 'output'].includes(direction)) {
      throw new BadRequestException(`invalid connector direction: ${direction}`);
    }
  }

  private applySearch(rows: ConnectorRowWithJoins[], search?: string): ConnectorRowWithJoins[] {
    if (!search) return rows;
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      if (row.name.toLowerCase().includes(needle)) return true;
      if (row.description?.toLowerCase().includes(needle)) return true;
      if (row.webhookPath?.toLowerCase().includes(needle)) return true;
      const configStr = row.config ? JSON.stringify(row.config).toLowerCase() : '';
      return configStr.includes(needle);
    });
  }

  // -------------------------------------------------------------------------
  // DTO mappers
  // -------------------------------------------------------------------------
  private toConfigSummary(row: ConnectorRowWithJoins): string {
    const config = row.config as Record<string, unknown> | null;
    if (!config) return '';
    if (row.type === 'redis') {
      const mode = String(config.mode ?? '');
      const key = String(config.key ?? '');
      return `${mode}: ${key}`;
    }
    if (row.type === 'kafka') {
      const topic = String(config.topic ?? '');
      const group = config.consumerGroup ? `·${String(config.consumerGroup)}` : '';
      return `topic: ${topic}${group}`;
    }
    if (row.type === 'webhook') {
      if (row.direction === 'input') {
        const mode = String(config.webhookMode ?? '');
        return `webhook ${mode}`;
      }
      const target = String(config.targetUrl ?? '');
      return `→ ${target}`;
    }
    return '';
  }

  private toListItem(
    row: ConnectorRowWithJoins,
    references: ConnectorReferencesSummaryDto,
    activeWebhookTokenCount: number,
  ): ConnectorListItemDto {
    const ipWhitelistArr = (row.ipWhitelist as string[] | null) ?? null;
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description ?? null,
      direction: row.direction as ConnectorListItemDto['direction'],
      type: row.type as ConnectorListItemDto['type'],
      webhookPath: row.webhookPath ?? null,
      hasToken: activeWebhookTokenCount > 0,
      ipWhitelistCount: ipWhitelistArr?.length ?? 0,
      configSummary: this.toConfigSummary(row),
      healthStatus: row.healthStatus as ConnectorListItemDto['healthStatus'],
      lastProbedAt: row.lastProbedAt?.toISOString() ?? null,
      lastProbeError: row.lastProbeError ?? null,
      references,
      createdBy: row.createdBy,
      createdByDisplayName: row.createdByDisplayName ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(
    row: ConnectorRowWithJoins,
    references: ConnectorReferencesSummaryDto,
    webhookTokens: ConnectorWebhookTokenSummaryDto[],
  ): ConnectorDetailDto {
    const listItem = this.toListItem(row, references, webhookTokens.length);
    return {
      ...listItem,
      config: row.config as ConnectorDetailDto['config'],
      webhookTokens,
      ipWhitelist: (row.ipWhitelist as string[] | null) ?? null,
    };
  }
}
