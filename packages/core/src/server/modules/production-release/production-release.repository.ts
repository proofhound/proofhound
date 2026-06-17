// Production release compatibility repository: read/write source of truth is ph_releases.release_lines / release_line_events
// See docs/specs/27-releases.md and docs/specs/06-database-schema.md
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

const { connectors, models, projects, prompts, promptVersions, promptVersionLabels } = schema;

export interface ProductionReleaseEventRow {
  id: string;
  projectId: string;
  promptId: string;
  eventType: string;
  promptVersionId: string;
  modelId: string;
  inputConnectorId: string | null;
  outputConnectorIds: string[];
  runConfig: unknown;
  variableMapping: unknown;
  filterRules: unknown | null;
  recordMode: 'all' | 'selected_categories' | 'correct_only';
  recordCategories: string[];
  externalIdField: string | null;
  retentionDays: number | null;
  status: string;
  createdBy: string;
  submitReason: string;
  sourceExperimentId: string | null;
  sourceCanaryId: string | null;
  sourceMetricsSnapshot: Record<string, unknown> | null;
  promptSnapshot: Record<string, unknown>;
  promptVersionSnapshot: Record<string, unknown>;
  rollbackTargetEventId: string | null;
  controlState: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  stopReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductionReleaseEventRowWithJoins extends ProductionReleaseEventRow {
  promptName: string | null;
  promptVersionNumber: number | null;
  modelName: string | null;
  modelProvider: string | null;
  inputConnectorName: string | null;
  inputConnectorType: string | null;
  createdByName: string | null;
}

export interface ProductionReleaseAggregateRow {
  promptId: string;
  promptName: string;
  currentEvent: ProductionReleaseEventRowWithJoins | null;
  outputConnectors: Array<{ id: string; name: string; type: string }>;
  lastEventType: string | null;
  lastEventCreatedAt: Date | null;
}

export interface ProductionReleaseProjectAccessRow {
  id: string;
}

export interface ProductionReleasePromptRow {
  id: string;
  name: string;
  defaultDatasetId: string | null;
}

export interface ProductionReleasePromptVersionRow {
  id: string;
  promptId: string;
  versionNumber: number;
  body: string | null;
  variables: unknown;
  outputSchema: unknown;
  judgmentRules: unknown;
  promptLanguage: string;
  isFrozen: boolean;
  createdBy: string;
  createdAt: Date;
  frozenAt: Date | null;
}

@Injectable()
export class ProductionReleaseRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  async findProjectAccess(
    _actorUserId: string,
    projectId: string,
    _isSuperAdmin: boolean,
  ): Promise<ProductionReleaseProjectAccessRow | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findEventById(projectId: string, eventId: string): Promise<ProductionReleaseEventRowWithJoins | null> {
    const rows = await this.db.execute(sql`
      ${productionEventSelectSql()}
      WHERE e.project_id = ${projectId}::uuid
        AND e.id = ${eventId}::uuid
        AND e.lane_type = 'production'
      LIMIT 1
    `);
    const row = unwrapRows<Record<string, unknown>>(rows)[0];
    return row ? mapProductionEventRow(row) : null;
  }

  async findRunningByPrompt(promptId: string): Promise<ProductionReleaseEventRow | null> {
    const rows = await this.db.execute(sql`
      ${productionEventSelectSql()}
      WHERE e.prompt_id = ${promptId}::uuid
        AND e.lane_type = 'production'
        AND e.status = 'running'
      LIMIT 1
    `);
    const row = unwrapRows<Record<string, unknown>>(rows)[0];
    return row ? mapProductionEventRow(row) : null;
  }

  async findRunningByInputConnector(inputConnectorId: string): Promise<ProductionReleaseEventRow | null> {
    const rows = await this.db.execute(sql`
      ${productionEventSelectSql()}
      WHERE e.input_connector_id = ${inputConnectorId}::uuid
        AND e.lane_type = 'production'
        AND e.status = 'running'
      LIMIT 1
    `);
    const row = unwrapRows<Record<string, unknown>>(rows)[0];
    return row ? mapProductionEventRow(row) : null;
  }

  async listEventsByPrompt(projectId: string, promptId: string): Promise<ProductionReleaseEventRowWithJoins[]> {
    const rows = await this.db.execute(sql`
      ${productionEventSelectSql()}
      WHERE e.project_id = ${projectId}::uuid
        AND e.prompt_id = ${promptId}::uuid
        AND e.lane_type = 'production'
      ORDER BY e.created_at DESC
    `);
    return unwrapRows<Record<string, unknown>>(rows).map(mapProductionEventRow);
  }

  async listAggregatedByProject(projectId: string): Promise<ProductionReleaseAggregateRow[]> {
    const promptRows = await this.db
      .select({ id: prompts.id, name: prompts.name })
      .from(prompts)
      .where(and(eq(prompts.projectId, projectId), isNull(prompts.deletedAt)));
    const eventRows = await this.db.execute(sql`
      ${productionEventSelectSql()}
      WHERE e.project_id = ${projectId}::uuid
        AND e.lane_type = 'production'
      ORDER BY e.created_at DESC
    `);
    const events = unwrapRows<Record<string, unknown>>(eventRows).map(mapProductionEventRow);
    const promptMap = new Map(promptRows.map((row) => [row.id, row.name]));
    const promptIds = Array.from(
      new Set([...promptRows.map((row) => row.id), ...events.map((event) => event.promptId)]),
    );
    if (promptIds.length === 0) return [];

    const outputIds = new Set<string>();
    for (const event of events) for (const id of event.outputConnectorIds) outputIds.add(id);
    const outputMap = await this.loadConnectorNames(Array.from(outputIds));

    const byPrompt = new Map<string, ProductionReleaseEventRowWithJoins[]>();
    for (const event of events) {
      const list = byPrompt.get(event.promptId) ?? [];
      list.push(event);
      byPrompt.set(event.promptId, list);
    }

    return promptIds.map((promptId) => {
      const promptEvents = byPrompt.get(promptId) ?? [];
      const latest = promptEvents[0] ?? null;
      const running = promptEvents.find((event) => event.status === 'running') ?? null;
      const current = running ?? latest;
      return {
        promptId,
        promptName: promptMap.get(promptId) ?? current?.promptName ?? promptId,
        currentEvent: current,
        outputConnectors: current ? current.outputConnectorIds.flatMap((id) => outputMap.get(id) ?? []) : [],
        lastEventType: latest?.eventType ?? null,
        lastEventCreatedAt: latest?.createdAt ?? null,
      };
    });
  }

  async findPromptForProject(projectId: string, promptId: string): Promise<ProductionReleasePromptRow | null> {
    const rows = await this.db
      .select({ id: prompts.id, name: prompts.name, defaultDatasetId: prompts.defaultDatasetId })
      .from(prompts)
      .where(
        and(
          eq(prompts.projectId, projectId),
          eq(prompts.id, promptId),
          eq(prompts.status, 'active'),
          isNull(prompts.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findPromptVersionForPrompt(
    promptId: string,
    versionId: string,
  ): Promise<ProductionReleasePromptVersionRow | null> {
    const rows = await this.db
      .select({
        id: promptVersions.id,
        promptId: promptVersions.promptId,
        versionNumber: promptVersions.versionNumber,
        body: promptVersions.body,
        variables: promptVersions.variables,
        outputSchema: promptVersions.outputSchema,
        judgmentRules: promptVersions.judgmentRules,
        promptLanguage: promptVersions.promptLanguage,
        isFrozen: promptVersions.isFrozen,
        createdBy: promptVersions.createdBy,
        createdAt: promptVersions.createdAt,
        frozenAt: promptVersions.frozenAt,
      })
      .from(promptVersions)
      .where(and(eq(promptVersions.promptId, promptId), eq(promptVersions.id, versionId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async freezePromptVersionIfNeeded(promptVersionId: string): Promise<void> {
    await this.db
      .update(promptVersions)
      .set({ isFrozen: true, frozenAt: sql`COALESCE(${promptVersions.frozenAt}, now())` })
      .where(and(eq(promptVersions.id, promptVersionId), eq(promptVersions.isFrozen, false)));
  }

  async markPromptVersionProduction(promptId: string, versionId: string, actorUserId: string): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(promptVersions)
        .set({ isFrozen: true, frozenAt: sql`COALESCE(${promptVersions.frozenAt}, now())` })
        .where(eq(promptVersions.id, versionId));
      await tx
        .insert(promptVersionLabels)
        .values({
          promptId,
          versionId,
          label: 'production',
          labelType: 'system',
          createdBy: actorUserId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [promptVersionLabels.promptId, promptVersionLabels.label],
          set: { versionId, labelType: 'system', updatedAt: now },
        });
      await tx
        .update(prompts)
        .set({ currentOnlineVersionId: versionId, updatedAt: now })
        .where(eq(prompts.id, promptId));
    });
  }

  async clearPromptProductionVersion(promptId: string): Promise<void> {
    await this.db
      .update(prompts)
      .set({ currentOnlineVersionId: null, updatedAt: new Date() })
      .where(eq(prompts.id, promptId));
  }

  async findModelById(modelId: string): Promise<{ id: string; name: string; providerType: string } | null> {
    const rows = await this.db
      .select({ id: models.id, name: models.name, providerType: models.providerType })
      .from(models)
      .where(and(eq(models.id, modelId), isNull(models.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findConnectorForProject(
    projectId: string,
    connectorId: string,
  ): Promise<{ id: string; name: string; type: string; direction: string } | null> {
    const rows = await this.db
      .select({ id: connectors.id, name: connectors.name, type: connectors.type, direction: connectors.direction })
      .from(connectors)
      .where(and(eq(connectors.projectId, projectId), eq(connectors.id, connectorId), isNull(connectors.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listConnectorsForProject(
    projectId: string,
    ids: string[],
  ): Promise<Array<{ id: string; name: string; type: string; direction: string }>> {
    if (ids.length === 0) return [];
    return this.db
      .select({ id: connectors.id, name: connectors.name, type: connectors.type, direction: connectors.direction })
      .from(connectors)
      .where(and(eq(connectors.projectId, projectId), inArray(connectors.id, ids), isNull(connectors.deletedAt)));
  }

  private async loadConnectorNames(ids: string[]): Promise<Map<string, { id: string; name: string; type: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: connectors.id, name: connectors.name, type: connectors.type })
      .from(connectors)
      .where(inArray(connectors.id, ids));
    return new Map(rows.map((row) => [row.id, row]));
  }
}

function productionEventSelectSql() {
  return sql`
    SELECT
      e.id,
      e.project_id,
      e.prompt_id,
      e.operation,
      e.prompt_version_id,
      e.model_id,
      e.input_connector_id,
      e.output_connector_ids,
      e.run_config,
      e.variable_mapping,
      e.filter_rules,
      e.record_mode,
      e.record_categories,
      e.external_id_field,
      e.retention_days,
      e.status,
      e.created_by,
      e.submit_reason,
      e.source_experiment_id,
      e.source_event_id,
      e.rollback_target_event_id,
      e.control_state,
      e.started_at,
      e.finished_at,
      e.terminal_reason,
      e.metrics,
      e.prompt_snapshot,
      e.prompt_version_snapshot,
      e.created_at,
      e.updated_at,
      COALESCE(p.name, e.prompt_name, e.prompt_snapshot->>'name') AS prompt_name,
      COALESCE(pv.version_number, e.prompt_version_number, NULLIF(e.prompt_version_snapshot->>'versionNumber', '')::int) AS prompt_version_number,
      COALESCE(m.name, e.model_snapshot->>'name') AS model_name,
      COALESCE(m.provider_type, e.model_snapshot->>'providerType', e.model_snapshot->>'provider') AS model_provider,
      COALESCE(ic.name, e.input_connector_snapshot->>'name') AS input_connector_name,
      COALESCE(ic.type, e.input_connector_snapshot->>'type') AS input_connector_type,
      NULL::text AS created_by_name
    FROM ph_releases.release_line_events e
    LEFT JOIN ph_assets.prompts p ON p.id = e.prompt_id
    LEFT JOIN ph_assets.prompt_versions pv ON pv.id = e.prompt_version_id
    LEFT JOIN ph_assets.models m ON m.id = e.model_id
    LEFT JOIN ph_assets.connectors ic ON ic.id = e.input_connector_id
  `;
}

function mapProductionEventRow(row: Record<string, unknown>): ProductionReleaseEventRowWithJoins {
  const promptSnapshot = asRecord(row['prompt_snapshot']);
  const promptVersionSnapshot = asRecord(row['prompt_version_snapshot']);
  return {
    id: row['id'] as string,
    projectId: row['project_id'] as string,
    promptId: row['prompt_id'] as string,
    eventType: eventTypeFromOperation(row['operation'] as string),
    promptVersionId: row['prompt_version_id'] as string,
    modelId: row['model_id'] as string,
    inputConnectorId: (row['input_connector_id'] as string | null) ?? null,
    outputConnectorIds: normalizeStringArray(row['output_connector_ids']),
    runConfig: row['run_config'] ?? {},
    variableMapping: row['variable_mapping'] ?? {},
    filterRules: (row['filter_rules'] as Record<string, unknown> | null) ?? null,
    recordMode: ((row['record_mode'] as string | null) ?? 'all') as ProductionReleaseEventRow['recordMode'],
    recordCategories: normalizeStringArray(row['record_categories']),
    externalIdField: (row['external_id_field'] as string | null) ?? null,
    retentionDays: toNumberOrNull(row['retention_days'] as number | string | null),
    status: productionStatusFromReleaseStatus(row['status'] as string),
    createdBy: row['created_by'] as string,
    submitReason: (row['submit_reason'] as string | null) ?? '',
    sourceExperimentId: (row['source_experiment_id'] as string | null) ?? null,
    sourceCanaryId: (row['source_event_id'] as string | null) ?? null,
    sourceMetricsSnapshot: row['metrics'] ? asRecord(row['metrics']) : null,
    promptSnapshot,
    promptVersionSnapshot,
    rollbackTargetEventId: (row['rollback_target_event_id'] as string | null) ?? null,
    controlState: (row['control_state'] as string | null) ?? null,
    startedAt: toDateOrNull(row['started_at']),
    finishedAt: toDateOrNull(row['finished_at']),
    stopReason: stopReasonFromTerminalReason(row['terminal_reason'] as string | null),
    createdAt: toDateOrNull(row['created_at']) ?? new Date(0),
    updatedAt: toDateOrNull(row['updated_at']) ?? new Date(0),
    promptName: (row['prompt_name'] as string | null) ?? stringFromRecord(promptSnapshot, 'name'),
    promptVersionNumber:
      toNumberOrNull(row['prompt_version_number'] as number | string | null) ??
      toNumberOrNull(promptVersionSnapshot['versionNumber'] as number | string | null),
    modelName: (row['model_name'] as string | null) ?? null,
    modelProvider: (row['model_provider'] as string | null) ?? null,
    inputConnectorName: (row['input_connector_name'] as string | null) ?? null,
    inputConnectorType: (row['input_connector_type'] as string | null) ?? null,
    createdByName: null,
  };
}

function eventTypeFromOperation(operation: string): string {
  if (operation === 'create_production_from_experiment') return 'from_experiment';
  if (operation === 'promote_canary') return 'from_canary';
  if (operation === 'config_changed') return 'config_change';
  if (operation === 'rollback') return 'rollback';
  if (operation === 'force_stop') return 'force_stop';
  return 'from_prompt';
}

function productionStatusFromReleaseStatus(status: string): string {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'stopped';
}

function stopReasonFromTerminalReason(reason: string | null): string | null {
  if (reason === 'replaced' || reason === 'rolled_back' || reason === 'force_stopped' || reason === 'error')
    return reason;
  return null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value as string);
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function unwrapRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) return (result as { rows?: T[] }).rows ?? [];
  return [];
}
