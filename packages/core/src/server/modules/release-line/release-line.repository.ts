import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type {
  ReleaseLineDto,
  ReleaseLineEventDto,
  ReleaseLineEventOperationDto,
  ReleaseLineEventStatusDto,
  ReleaseLineEventTerminalReasonDto,
  ReleaseLineLaneTypeDto,
  ReleaseLineStatusDto,
  UpdateReleaseLineRunConfigInputDto,
} from '@proofhound/shared';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

const { annotationTasks, connectors, models, projects, releaseLineEvents, releaseLines, releaseVariants } = schema;

type ReleaseLineRow = typeof releaseLines.$inferSelect;
type ReleaseLineEventRow = typeof releaseLineEvents.$inferSelect;
type ReleaseLineEventInsert = typeof releaseLineEvents.$inferInsert;
type ReleaseVariantRow = typeof releaseVariants.$inferSelect;
type ReleaseLineDbExecutor = Pick<DbClient, 'select' | 'insert' | 'update'>;

interface ReleaseLineModelSnapshotUpdate {
  id: string;
  name: string;
  providerType: string;
  isActive: boolean;
}

export interface ReleaseLineIdentity {
  promptId?: string | null;
  inputConnectorId?: string | null;
}

export interface ReleaseLineMirrorSnapshot {
  projectId: string;
  lineName: string;
  lineDescription?: string | null;
  promptId: string | null;
  promptName: string;
  promptSnapshot: Record<string, unknown>;
  promptVersionId: string | null;
  promptVersionNumber: number | null;
  promptVersionSnapshot: Record<string, unknown>;
  modelId: string | null;
  modelName: string | null;
  modelProvider: string | null;
  inputConnectorId: string | null;
  inputConnectorName: string | null;
  inputConnectorType: string | null;
  outputConnectorIds: string[];
  laneType: ReleaseLineLaneTypeDto;
  operation: ReleaseLineEventOperationDto;
  status: ReleaseLineEventStatusDto;
  terminalReason?: ReleaseLineEventTerminalReasonDto | null;
  sourceEventId?: string | null;
  supersedesEventId?: string | null;
  rollbackTargetEventId?: string | null;
  trafficMode?: 'split' | 'dual_run' | null;
  trafficRatio?: number | null;
  runConfig: unknown;
  variableMapping: unknown;
  outputMapping?: unknown;
  filterRules?: unknown | null;
  recordMode: 'all' | 'correct_only';
  externalIdField?: string | null;
  retentionDays?: number | null;
  sourceExperimentId?: string | null;
  submitReason?: string;
  metrics?: Record<string, unknown> | null;
  totalReceived?: number;
  totalProcessed?: number;
  totalFiltered?: number;
  totalCorrect?: number;
  totalErrors?: number;
  controlState?: string | null;
  controlStatePayload?: Record<string, unknown> | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdBy: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  legacySource?: 'production_release_event' | 'canary_release' | null;
  legacySourceId?: string | null;
}

@Injectable()
export class ReleaseLineRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  async findProjectAccess(projectId: string): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(projectId: string): Promise<ReleaseLineDto[]> {
    const lines = await this.db
      .select()
      .from(releaseLines)
      .where(eq(releaseLines.projectId, projectId))
      .orderBy(desc(releaseLines.updatedAt));
    return this.hydrateLines(lines);
  }

  async findById(projectId: string, releaseLineId: string): Promise<ReleaseLineDto | null> {
    const rows = await this.db
      .select()
      .from(releaseLines)
      .where(and(eq(releaseLines.projectId, projectId), eq(releaseLines.id, releaseLineId)))
      .limit(1);
    const line = rows[0];
    if (!line) return null;
    const hydrated = await this.hydrateLines([line]);
    return hydrated[0] ?? null;
  }

  async findByName(projectId: string, name: string): Promise<{ id: string; name: string } | null> {
    const rows = await this.db
      .select({ id: releaseLines.id, name: releaseLines.name })
      .from(releaseLines)
      .where(and(eq(releaseLines.projectId, projectId), eq(releaseLines.name, name)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdentity(projectId: string, identity: ReleaseLineIdentity): Promise<{ id: string; name: string } | null> {
    const rows = await this.db
      .select({ id: releaseLines.id, name: releaseLines.name })
      .from(releaseLines)
      .where(and(eq(releaseLines.projectId, projectId), releaseLineIdentityCondition(identity)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listEvents(projectId: string, releaseLineId: string): Promise<ReleaseLineEventDto[]> {
    const rows = await this.db
      .select()
      .from(releaseLineEvents)
      .where(and(eq(releaseLineEvents.projectId, projectId), eq(releaseLineEvents.releaseLineId, releaseLineId)))
      .orderBy(desc(releaseLineEvents.createdAt));
    return this.hydrateEvents(rows);
  }

  async record(snapshot: ReleaseLineMirrorSnapshot): Promise<ReleaseLineDto> {
    const releaseLineId = await this.db.transaction(async (tx) => {
      const now = snapshot.updatedAt ?? new Date();
      const existingLegacyEvent = await this.findExistingLegacyEvent(tx, snapshot);
      if (existingLegacyEvent) return existingLegacyEvent.releaseLineId;

      const line = await this.findOrCreateLine(tx, snapshot, now);
      let supersedesEventId = snapshot.supersedesEventId ?? null;

      if (snapshot.laneType === 'production' && snapshot.status === 'running') {
        const previousRunning = await tx
          .select({ id: releaseLineEvents.id })
          .from(releaseLineEvents)
          .where(
            and(
              eq(releaseLineEvents.releaseLineId, line.id),
              eq(releaseLineEvents.laneType, 'production'),
              eq(releaseLineEvents.status, 'running'),
            ),
          )
          .limit(1);
        supersedesEventId = supersedesEventId ?? previousRunning[0]?.id ?? null;
        await tx
          .update(releaseLineEvents)
          .set({
            status: 'stopped',
            terminalReason: snapshot.operation === 'rollback' ? 'rolled_back' : 'replaced',
            finishedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(releaseLineEvents.releaseLineId, line.id),
              eq(releaseLineEvents.laneType, 'production'),
              eq(releaseLineEvents.status, 'running'),
            ),
          );
      }

      if (snapshot.laneType === 'production' && snapshot.operation === 'force_stop') {
        await tx
          .update(releaseLineEvents)
          .set({
            status: 'stopped',
            terminalReason: 'force_stopped',
            finishedAt: now,
            controlState: null,
            controlStatePayload: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(releaseLineEvents.releaseLineId, line.id),
              eq(releaseLineEvents.laneType, 'production'),
              eq(releaseLineEvents.status, 'running'),
            ),
          );
        await tx
          .update(releaseLineEvents)
          .set({
            status: 'cancelled',
            terminalReason: 'cancelled',
            finishedAt: now,
            controlState: null,
            controlStatePayload: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(releaseLineEvents.releaseLineId, line.id),
              eq(releaseLineEvents.laneType, 'canary'),
              sql`${releaseLineEvents.status} IN ('running', 'stopped')`,
            ),
          );
      }

      if (snapshot.laneType === 'canary') {
        await tx
          .update(releaseLineEvents)
          .set({ status: 'completed', terminalReason: 'replaced', finishedAt: now, updatedAt: now })
          .where(
            and(
              eq(releaseLineEvents.releaseLineId, line.id),
              eq(releaseLineEvents.laneType, 'canary'),
              sql`${releaseLineEvents.status} IN ('running', 'stopped')`,
            ),
          );
      }

      const releaseVariant = await this.findOrCreateVariant(tx, line.id, snapshot, now);
      const eventValues = await this.buildEventInsert(snapshot, line.id, supersedesEventId, releaseVariant?.id ?? null, now);
      const inserted = await tx.insert(releaseLineEvents).values(eventValues).returning();
      const event = inserted[0];
      if (!event) throw new Error('release_line_events insert returned no row');
      await this.updateLinePointers(tx, line.id, event, now);
      return line.id;
    });
    const result = await this.findById(snapshot.projectId, releaseLineId);
    if (!result) throw new Error('release_lines row disappeared after event insert');
    return result;
  }

  async updateActiveCanaryTrafficRatio(
    projectId: string,
    releaseLineId: string,
    trafficRatio: number,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    const canary = line?.activeCanaryEvent;
    if (!line || !canary || (canary.status !== 'running' && canary.status !== 'stopped')) return null;
    if (canary.status === 'running' && canary.trafficMode === 'split' && trafficRatio >= 1) {
      const promoted = await this.record(
        resetRuntimeStats({
          ...eventDtoToSnapshot(line, canary),
          laneType: 'production',
          operation: 'promote_canary',
          status: 'running',
          terminalReason: null,
          sourceEventId: canary.id,
          trafficMode: null,
          trafficRatio: null,
          submitReason: promotionSubmitReason(line),
          createdBy: actorUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
          legacySource: null,
          legacySourceId: null,
        }),
      );
      await this.completeCanaryEvent(canary.id, 'promoted');
      return this.findById(projectId, promoted.id);
    }

    await this.record(
      resetRuntimeStats({
        ...eventDtoToSnapshot(line, canary),
        operation: 'traffic_updated',
        status: canary.status,
        trafficRatio,
        submitReason: `traffic ${Math.round(trafficRatio * 100)}%`,
        createdBy: actorUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        legacySource: null,
        legacySourceId: null,
      }),
    );
    return this.findById(projectId, releaseLineId);
  }

  async updateActiveLaneRunConfig(
    projectId: string,
    releaseLineId: string,
    input: UpdateReleaseLineRunConfigInputDto,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    if (!line) return null;

    const event = input.laneType === 'production' ? line.currentProductionEvent : line.activeCanaryEvent;
    if (!event) return null;
    if (event.status !== 'running' && event.status !== 'stopped') return null;

    const now = new Date();
    const nextModel =
      input.modelId && input.modelId !== event.modelId
        ? await this.findModelSnapshotForProject(projectId, input.modelId)
        : null;
    if (input.modelId && input.modelId !== event.modelId && (!nextModel || !nextModel.isActive)) return null;

    const updated = await this.record(
      resetRuntimeStats({
        ...eventDtoToSnapshot(line, event),
        operation: 'config_changed',
        terminalReason: null,
        supersedesEventId: event.id,
        modelId: nextModel?.id ?? event.modelId,
        modelName: nextModel?.name ?? event.modelName,
        modelProvider: nextModel?.providerType ?? event.modelProvider,
        runConfig: input.runConfig,
        submitReason:
          nextModel && input.laneType === 'production'
            ? '正式发布模型与运行配置变更'
            : nextModel
              ? '灰度发布模型与运行配置变更'
              : input.laneType === 'production'
                ? '正式发布运行配置变更'
                : '灰度发布运行配置变更',
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
        legacySource: null,
        legacySourceId: null,
      }),
    );
    return this.findById(projectId, updated.id);
  }

  private async findModelSnapshotForProject(
    projectId: string,
    modelId: string,
  ): Promise<ReleaseLineModelSnapshotUpdate | null> {
    const rows = await this.db
      .select({
        id: models.id,
        name: models.name,
        providerType: models.providerType,
        isActive: models.isActive,
      })
      .from(models)
      .where(and(eq(models.projectId, projectId), eq(models.id, modelId), isNull(models.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async completeCanaryEvent(eventId: string, terminalReason: ReleaseLineEventTerminalReasonDto): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();
      const updated = await tx
        .update(releaseLineEvents)
        .set({
          status: 'completed',
          terminalReason,
          finishedAt: now,
          controlState: null,
          controlStatePayload: null,
          updatedAt: now,
        })
        .where(and(eq(releaseLineEvents.id, eventId), eq(releaseLineEvents.laneType, 'canary')))
        .returning();
      const event = updated[0];
      if (event) await this.updateLinePointers(tx, event.releaseLineId, event, now);
    });
  }

  private async hydrateLines(lines: ReleaseLineRow[]): Promise<ReleaseLineDto[]> {
    if (lines.length === 0) return [];
    const eventIds = new Set<string>();
    for (const line of lines) {
      if (line.currentProductionEventId) eventIds.add(line.currentProductionEventId);
      if (line.activeCanaryEventId) eventIds.add(line.activeCanaryEventId);
    }
    const latestRows = await this.db
      .select()
      .from(releaseLineEvents)
      .where(
        inArray(
          releaseLineEvents.releaseLineId,
          lines.map((line) => line.id),
        ),
      )
      .orderBy(desc(releaseLineEvents.createdAt));
    const explicitEvents =
      eventIds.size > 0
        ? await this.db
            .select()
            .from(releaseLineEvents)
            .where(inArray(releaseLineEvents.id, Array.from(eventIds)))
        : [];
    const variantRows = await this.db
      .select()
      .from(releaseVariants)
      .where(
        inArray(
          releaseVariants.releaseLineId,
          lines.map((line) => line.id),
        ),
      )
      .orderBy(releaseVariants.variantNumber);
    const hydratedEvents = await this.hydrateEvents([...latestRows, ...explicitEvents]);
    const eventById = new Map(hydratedEvents.map((event) => [event.id, event]));
    const latestByLine = new Map<string, ReleaseLineEventDto>();
    for (const event of hydratedEvents) {
      if (!latestByLine.has(event.releaseLineId)) latestByLine.set(event.releaseLineId, event);
    }
    const variantsByLine = new Map<string, ReturnType<typeof toReleaseVariantDto>[]>();
    for (const variant of variantRows) {
      const list = variantsByLine.get(variant.releaseLineId) ?? [];
      list.push(toReleaseVariantDto(variant));
      variantsByLine.set(variant.releaseLineId, list);
    }

    return lines.map((line) => {
      const currentProductionEvent = line.currentProductionEventId
        ? (eventById.get(line.currentProductionEventId) ?? null)
        : null;
      const activeCanaryEvent = line.activeCanaryEventId ? (eventById.get(line.activeCanaryEventId) ?? null) : null;
      return {
        id: line.id,
        projectId: line.projectId,
        name: line.name,
        description: line.description,
        promptId: line.promptId,
        promptName: line.promptName,
        promptSnapshot: asRecord(line.promptSnapshot),
        inputConnectorId: line.inputConnectorId,
        inputConnectorName: line.inputConnectorName,
        inputConnectorType: line.inputConnectorType,
        inputConnectorSnapshot: asRecord(line.inputConnectorSnapshot),
        status: line.status as ReleaseLineStatusDto,
        currentProductionEventId: line.currentProductionEventId,
        activeCanaryEventId: line.activeCanaryEventId,
        currentProductionEvent,
        activeCanaryEvent,
        variants: variantsByLine.get(line.id) ?? [],
        outputConnectors: mergeOutputConnectors(currentProductionEvent, activeCanaryEvent),
        latestEvent: latestByLine.get(line.id) ?? null,
        createdBy: line.createdBy,
        createdAt: line.createdAt.toISOString(),
        updatedAt: line.updatedAt.toISOString(),
        archivedAt: line.archivedAt ? line.archivedAt.toISOString() : null,
      };
    });
  }

  private async hydrateEvents(rows: ReleaseLineEventRow[]): Promise<ReleaseLineEventDto[]> {
    if (rows.length === 0) return [];
    const outputIds = new Set<string>();
    const sourceEventIds = new Set<string>();
    const eventIds = new Set<string>();
    const variantIds = new Set<string>();
    for (const row of rows) {
      eventIds.add(row.id);
      for (const id of row.outputConnectorIds ?? []) outputIds.add(id);
      if (row.sourceEventId) sourceEventIds.add(row.sourceEventId);
      if (row.releaseVariantId) variantIds.add(row.releaseVariantId);
    }
    const outputMap = new Map<string, { id: string; name: string; type: string }>();
    if (outputIds.size > 0) {
      const outputRows = await this.db
        .select({ id: connectors.id, name: connectors.name, type: connectors.type })
        .from(connectors)
        .where(inArray(connectors.id, Array.from(outputIds)));
      for (const output of outputRows) outputMap.set(output.id, output);
    }
    const sourceEventMap = new Map<
      string,
      { legacySource: ReleaseLineEventDto['legacySource']; legacySourceId: string | null }
    >();
    if (sourceEventIds.size > 0) {
      const sourceRows = await this.db
        .select({
          id: releaseLineEvents.id,
          legacySource: releaseLineEvents.legacySource,
          legacySourceId: releaseLineEvents.legacySourceId,
        })
        .from(releaseLineEvents)
        .where(inArray(releaseLineEvents.id, Array.from(sourceEventIds)));
      for (const source of sourceRows) {
        sourceEventMap.set(source.id, {
          legacySource: source.legacySource as ReleaseLineEventDto['legacySource'],
          legacySourceId: source.legacySourceId,
        });
      }
    }
    const variantMap = new Map<string, ReleaseVariantRow>();
    if (variantIds.size > 0) {
      const variantRows = await this.db
        .select()
        .from(releaseVariants)
        .where(inArray(releaseVariants.id, Array.from(variantIds)));
      for (const variant of variantRows) variantMap.set(variant.id, variant);
    }
    const annotationTaskMap = new Map<string, string>();
    if (eventIds.size > 0) {
      const taskRows = await this.db
        .select({ id: annotationTasks.id, releaseLineEventId: annotationTasks.releaseLineEventId })
        .from(annotationTasks)
        .where(inArray(annotationTasks.releaseLineEventId, Array.from(eventIds)));
      for (const task of taskRows) {
        if (task.releaseLineEventId && !annotationTaskMap.has(task.releaseLineEventId)) {
          annotationTaskMap.set(task.releaseLineEventId, task.id);
        }
      }
    }
    return rows.map((row) => {
      const variant = row.releaseVariantId ? (variantMap.get(row.releaseVariantId) ?? null) : null;
      const outputSnapshots = asArrayOfRecords(row.outputConnectorSnapshots);
      const outputConnectors = (row.outputConnectorIds ?? []).map((id) => {
        const fromJoin = outputMap.get(id);
        if (fromJoin) return fromJoin;
        const fromSnapshot = outputSnapshots.find((snapshot) => snapshot['id'] === id);
        return {
          id,
          name: typeof fromSnapshot?.['name'] === 'string' ? fromSnapshot['name'] : id,
          type: typeof fromSnapshot?.['type'] === 'string' ? fromSnapshot['type'] : 'connector',
        };
      });
      const promptVersionNumber =
        row.promptVersionNumber ?? numberFromSnapshot(row.promptVersionSnapshot, 'versionNumber');
      return {
        id: row.id,
        projectId: row.projectId,
        releaseLineId: row.releaseLineId,
        releaseVariantId: row.releaseVariantId,
        releaseVariantNumber: variant?.variantNumber ?? null,
        releaseVariantLabel: variant ? formatReleaseVariantLabel(variant.variantNumber) : null,
        annotationTaskId: annotationTaskMap.get(row.id) ?? null,
        laneType: row.laneType as ReleaseLineLaneTypeDto,
        operation: row.operation as ReleaseLineEventOperationDto,
        status: row.status as ReleaseLineEventStatusDto,
        terminalReason: row.terminalReason as ReleaseLineEventTerminalReasonDto | null,
        sourceEventId: row.sourceEventId,
        sourceLegacySource: row.sourceEventId ? (sourceEventMap.get(row.sourceEventId)?.legacySource ?? null) : null,
        sourceLegacyId: row.sourceEventId ? (sourceEventMap.get(row.sourceEventId)?.legacySourceId ?? null) : null,
        supersedesEventId: row.supersedesEventId,
        rollbackTargetEventId: row.rollbackTargetEventId,
        legacySource: row.legacySource as ReleaseLineEventDto['legacySource'],
        legacySourceId: row.legacySourceId,
        promptId: row.promptId,
        promptName: row.promptName,
        promptVersionId: row.promptVersionId,
        promptVersionNumber,
        promptVersionLabel: promptVersionNumber ? `v${promptVersionNumber}` : null,
        promptSnapshot: asRecord(row.promptSnapshot),
        promptVersionSnapshot: asRecord(row.promptVersionSnapshot),
        modelId: row.modelId,
        modelName: stringFromSnapshot(row.modelSnapshot, 'name'),
        modelProvider:
          stringFromSnapshot(row.modelSnapshot, 'providerType') ?? stringFromSnapshot(row.modelSnapshot, 'provider'),
        modelSnapshot: asRecord(row.modelSnapshot),
        inputConnectorId: row.inputConnectorId,
        inputConnectorName: stringFromSnapshot(row.inputConnectorSnapshot, 'name'),
        inputConnectorType: stringFromSnapshot(row.inputConnectorSnapshot, 'type'),
        inputConnectorSnapshot: asRecord(row.inputConnectorSnapshot),
        outputConnectorIds: row.outputConnectorIds ?? [],
        outputConnectors,
        outputConnectorSnapshots: outputSnapshots,
        trafficMode: row.trafficMode as ReleaseLineEventDto['trafficMode'],
        trafficRatio: row.trafficRatio === null ? null : Number(row.trafficRatio),
        runConfig: asRecord(row.runConfig),
        variableMapping: row.variableMapping,
        outputMapping: row.outputMapping,
        filterRules: row.filterRules,
        recordMode: row.recordMode as ReleaseLineEventDto['recordMode'],
        externalIdField: row.externalIdField,
        retentionDays: row.retentionDays,
        sourceExperimentId: row.sourceExperimentId,
        submitReason: row.submitReason,
        metrics: row.metrics ? asRecord(row.metrics) : null,
        totalReceived: row.totalReceived,
        totalProcessed: row.totalProcessed,
        totalFiltered: row.totalFiltered,
        totalCorrect: row.totalCorrect,
        totalErrors: row.totalErrors,
        controlState: row.controlState,
        controlStatePayload: row.controlStatePayload ? asRecord(row.controlStatePayload) : null,
        startedAt: row.startedAt ? row.startedAt.toISOString() : null,
        finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  private async findOrCreateLine(
    tx: ReleaseLineDbExecutor,
    snapshot: ReleaseLineMirrorSnapshot,
    now: Date,
  ): Promise<ReleaseLineRow> {
    const existing = await tx
      .select()
      .from(releaseLines)
      .where(and(eq(releaseLines.projectId, snapshot.projectId), releaseLineIdentityCondition(snapshot)))
      .limit(1);
    const found = existing[0];
    if (found) {
      const updates = await tx
        .update(releaseLines)
        .set({
          promptName: snapshot.promptName,
          promptSnapshot: snapshot.promptSnapshot as never,
          inputConnectorName: snapshot.inputConnectorName,
          inputConnectorType: snapshot.inputConnectorType,
          inputConnectorSnapshot: connectorSnapshot(
            snapshot.inputConnectorId,
            snapshot.inputConnectorName,
            snapshot.inputConnectorType,
          ) as never,
          updatedAt: now,
        })
        .where(eq(releaseLines.id, found.id))
        .returning();
      return updates[0] ?? found;
    }

    const inserted = await tx
      .insert(releaseLines)
      .values({
        projectId: snapshot.projectId,
        name: snapshot.lineName,
        description: snapshot.lineDescription ?? null,
        promptId: snapshot.promptId ?? undefined,
        promptName: snapshot.promptName,
        promptSnapshot: snapshot.promptSnapshot as never,
        inputConnectorId: snapshot.inputConnectorId ?? undefined,
        inputConnectorName: snapshot.inputConnectorName,
        inputConnectorType: snapshot.inputConnectorType,
        inputConnectorSnapshot: connectorSnapshot(
          snapshot.inputConnectorId,
          snapshot.inputConnectorName,
          snapshot.inputConnectorType,
        ) as never,
        status: snapshot.laneType === 'production' ? 'production' : 'canary',
        createdBy: snapshot.createdBy,
        createdAt: snapshot.createdAt ?? now,
        updatedAt: now,
      })
      .returning();
    const line = inserted[0];
    if (!line) throw new Error('release_lines insert returned no row');
    return line;
  }

  private async findOrCreateVariant(
    tx: ReleaseLineDbExecutor,
    releaseLineId: string,
    snapshot: ReleaseLineMirrorSnapshot,
    now: Date,
  ): Promise<ReleaseVariantRow | null> {
    if (!snapshot.promptVersionId || !snapshot.modelId) return null;
    const existing = await tx
      .select()
      .from(releaseVariants)
      .where(
        and(
          eq(releaseVariants.releaseLineId, releaseLineId),
          eq(releaseVariants.promptVersionId, snapshot.promptVersionId),
          eq(releaseVariants.modelId, snapshot.modelId),
        ),
      )
      .limit(1);
    const found = existing[0];
    if (found) {
      const updated = await tx
        .update(releaseVariants)
        .set({
          promptName: snapshot.promptName,
          promptVersionNumber: snapshot.promptVersionNumber ?? null,
          promptSnapshot: snapshot.promptSnapshot as never,
          promptVersionSnapshot: snapshot.promptVersionSnapshot as never,
          modelSnapshot: modelSnapshot(snapshot.modelId, snapshot.modelName, snapshot.modelProvider) as never,
          updatedAt: now,
        })
        .where(eq(releaseVariants.id, found.id))
        .returning();
      return updated[0] ?? found;
    }

    const maxRows = await tx
      .select({ maxVariantNumber: sql<number | null>`MAX(${releaseVariants.variantNumber})::int` })
      .from(releaseVariants)
      .where(eq(releaseVariants.releaseLineId, releaseLineId));
    const variantNumber = Number(maxRows[0]?.maxVariantNumber ?? 0) + 1;
    const inserted = await tx
      .insert(releaseVariants)
      .values({
        projectId: snapshot.projectId,
        releaseLineId,
        variantNumber,
        promptId: snapshot.promptId ?? null,
        promptName: snapshot.promptName,
        promptVersionId: snapshot.promptVersionId,
        promptVersionNumber: snapshot.promptVersionNumber ?? null,
        promptSnapshot: snapshot.promptSnapshot as never,
        promptVersionSnapshot: snapshot.promptVersionSnapshot as never,
        modelId: snapshot.modelId,
        modelSnapshot: modelSnapshot(snapshot.modelId, snapshot.modelName, snapshot.modelProvider) as never,
        createdBy: snapshot.createdBy,
        createdAt: snapshot.createdAt ?? now,
        updatedAt: now,
      })
      .returning();
    return inserted[0] ?? null;
  }

  private async findExistingLegacyEvent(tx: ReleaseLineDbExecutor, snapshot: ReleaseLineMirrorSnapshot) {
    if (!snapshot.legacySource || !snapshot.legacySourceId) return null;
    const rows = await tx
      .select({ releaseLineId: releaseLineEvents.releaseLineId })
      .from(releaseLineEvents)
      .where(
        and(
          eq(releaseLineEvents.projectId, snapshot.projectId),
          eq(releaseLineEvents.legacySource, snapshot.legacySource),
          eq(releaseLineEvents.legacySourceId, snapshot.legacySourceId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async buildEventInsert(
    snapshot: ReleaseLineMirrorSnapshot,
    releaseLineId: string,
    supersedesEventId: string | null,
    releaseVariantId: string | null,
    now: Date,
  ): Promise<ReleaseLineEventInsert> {
    const outputSnapshots = await this.loadOutputConnectorSnapshots(snapshot.outputConnectorIds);
    return {
      projectId: snapshot.projectId,
      releaseLineId,
      laneType: snapshot.laneType,
      operation: snapshot.operation,
      status: snapshot.status,
      terminalReason: snapshot.terminalReason ?? null,
      sourceEventId: snapshot.sourceEventId ?? null,
      supersedesEventId,
      rollbackTargetEventId: snapshot.rollbackTargetEventId ?? null,
      legacySource: snapshot.legacySource ?? null,
      legacySourceId: snapshot.legacySourceId ?? null,
      releaseVariantId,
      promptId: snapshot.promptId ?? null,
      promptName: snapshot.promptName,
      promptVersionId: snapshot.promptVersionId ?? null,
      promptVersionNumber: snapshot.promptVersionNumber ?? null,
      promptSnapshot: snapshot.promptSnapshot as never,
      promptVersionSnapshot: snapshot.promptVersionSnapshot as never,
      modelId: snapshot.modelId ?? null,
      modelSnapshot: modelSnapshot(snapshot.modelId, snapshot.modelName, snapshot.modelProvider) as never,
      inputConnectorId: snapshot.inputConnectorId ?? null,
      inputConnectorSnapshot: connectorSnapshot(
        snapshot.inputConnectorId,
        snapshot.inputConnectorName,
        snapshot.inputConnectorType,
      ) as never,
      outputConnectorIds: snapshot.outputConnectorIds,
      outputConnectorSnapshots: outputSnapshots as never,
      trafficMode: snapshot.trafficMode ?? null,
      trafficRatio:
        snapshot.trafficRatio === null || snapshot.trafficRatio === undefined ? null : String(snapshot.trafficRatio),
      runConfig: asRecord(snapshot.runConfig) as never,
      variableMapping: snapshot.variableMapping as never,
      outputMapping: (snapshot.outputMapping ?? []) as never,
      filterRules: snapshot.filterRules as never,
      recordMode: snapshot.recordMode,
      externalIdField: snapshot.externalIdField ?? null,
      retentionDays: snapshot.retentionDays ?? null,
      sourceExperimentId: snapshot.sourceExperimentId ?? null,
      submitReason: snapshot.submitReason ?? '',
      metrics: snapshot.metrics as never,
      totalReceived: snapshot.totalReceived ?? 0,
      totalProcessed: snapshot.totalProcessed ?? 0,
      totalFiltered: snapshot.totalFiltered ?? 0,
      totalCorrect: snapshot.totalCorrect ?? 0,
      totalErrors: snapshot.totalErrors ?? 0,
      controlState: snapshot.controlState ?? null,
      controlStatePayload: snapshot.controlStatePayload as never,
      startedAt: snapshot.startedAt ?? null,
      finishedAt: snapshot.finishedAt ?? null,
      createdBy: snapshot.createdBy,
      createdAt: snapshot.createdAt ?? now,
      updatedAt: now,
    };
  }

  private async updateLinePointers(
    tx: ReleaseLineDbExecutor,
    releaseLineId: string,
    event: ReleaseLineEventRow,
    now: Date,
  ) {
    const productionRows = await tx
      .select({ id: releaseLineEvents.id })
      .from(releaseLineEvents)
      .where(
        and(
          eq(releaseLineEvents.releaseLineId, releaseLineId),
          eq(releaseLineEvents.laneType, 'production'),
          eq(releaseLineEvents.status, 'running'),
        ),
      )
      .orderBy(desc(releaseLineEvents.createdAt))
      .limit(1);
    const canaryRows = await tx
      .select({ id: releaseLineEvents.id })
      .from(releaseLineEvents)
      .where(
        and(
          eq(releaseLineEvents.releaseLineId, releaseLineId),
          eq(releaseLineEvents.laneType, 'canary'),
          sql`${releaseLineEvents.status} IN ('running', 'stopped')`,
        ),
      )
      .orderBy(desc(releaseLineEvents.createdAt))
      .limit(1);
    const currentProductionEventId = productionRows[0]?.id ?? null;
    const activeCanaryEventId = canaryRows[0]?.id ?? null;
    const status = lineStatus(currentProductionEventId, activeCanaryEventId);
    await tx
      .update(releaseLines)
      .set({
        currentProductionEventId,
        activeCanaryEventId,
        status,
        updatedAt: now,
        archivedAt: status === 'archived' ? now : null,
      })
      .where(eq(releaseLines.id, releaseLineId));
  }

  private async loadOutputConnectorSnapshots(outputConnectorIds: string[]) {
    if (outputConnectorIds.length === 0) return [];
    const rows = await this.db
      .select({ id: connectors.id, name: connectors.name, type: connectors.type })
      .from(connectors)
      .where(inArray(connectors.id, outputConnectorIds));
    const map = new Map(rows.map((row) => [row.id, row]));
    return outputConnectorIds.map((id) => map.get(id) ?? { id, name: id, type: 'connector' });
  }
}

function lineStatus(currentProductionEventId: string | null, activeCanaryEventId: string | null): ReleaseLineStatusDto {
  if (currentProductionEventId && activeCanaryEventId) return 'production_with_canary';
  if (currentProductionEventId) return 'production';
  if (activeCanaryEventId) return 'canary';
  return 'stopped';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function stringFromSnapshot(snapshot: unknown, key: string): string | null {
  const value = asRecord(snapshot)[key];
  return typeof value === 'string' ? value : null;
}

function numberFromSnapshot(snapshot: unknown, key: string): number | null {
  const value = asRecord(snapshot)[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function connectorSnapshot(id: string | null, name: string | null, type: string | null) {
  return { id, name, type };
}

function modelSnapshot(id: string | null, name: string | null, providerType: string | null) {
  return { id, name, providerType };
}

function formatReleaseVariantLabel(variantNumber: number) {
  return `#${variantNumber}`;
}

function toReleaseVariantDto(variant: ReleaseVariantRow) {
  const promptVersionNumber =
    variant.promptVersionNumber ?? numberFromSnapshot(variant.promptVersionSnapshot, 'versionNumber');
  return {
    id: variant.id,
    projectId: variant.projectId,
    releaseLineId: variant.releaseLineId,
    variantNumber: variant.variantNumber,
    label: formatReleaseVariantLabel(variant.variantNumber),
    promptId: variant.promptId,
    promptName: variant.promptName,
    promptVersionId: variant.promptVersionId,
    promptVersionNumber,
    promptVersionLabel: promptVersionNumber ? `v${promptVersionNumber}` : null,
    promptSnapshot: asRecord(variant.promptSnapshot),
    promptVersionSnapshot: asRecord(variant.promptVersionSnapshot),
    modelId: variant.modelId,
    modelName: stringFromSnapshot(variant.modelSnapshot, 'name'),
    modelProvider:
      stringFromSnapshot(variant.modelSnapshot, 'providerType') ?? stringFromSnapshot(variant.modelSnapshot, 'provider'),
    modelSnapshot: asRecord(variant.modelSnapshot),
    createdBy: variant.createdBy,
    createdAt: variant.createdAt.toISOString(),
    updatedAt: variant.updatedAt.toISOString(),
  };
}

function mergeOutputConnectors(production: ReleaseLineEventDto | null, canary: ReleaseLineEventDto | null) {
  const map = new Map<string, { id: string; name: string; type: string }>();
  for (const connector of production?.outputConnectors ?? []) map.set(connector.id, connector);
  for (const connector of canary?.outputConnectors ?? []) map.set(connector.id, connector);
  return [...map.values()];
}

function eventDtoToSnapshot(line: ReleaseLineDto, event: ReleaseLineEventDto): ReleaseLineMirrorSnapshot {
  return {
    projectId: event.projectId,
    lineName: line.name,
    lineDescription: line.description,
    promptId: event.promptId,
    promptName: event.promptName,
    promptSnapshot: event.promptSnapshot,
    promptVersionId: event.promptVersionId,
    promptVersionNumber: event.promptVersionNumber,
    promptVersionSnapshot: event.promptVersionSnapshot,
    modelId: event.modelId,
    modelName: event.modelName,
    modelProvider: event.modelProvider,
    inputConnectorId: event.inputConnectorId,
    inputConnectorName: event.inputConnectorName,
    inputConnectorType: event.inputConnectorType,
    outputConnectorIds: event.outputConnectorIds,
    laneType: event.laneType,
    operation: event.operation,
    status: event.status,
    terminalReason: event.terminalReason,
    sourceEventId: event.sourceEventId,
    supersedesEventId: event.supersedesEventId,
    rollbackTargetEventId: event.rollbackTargetEventId,
    trafficMode: event.trafficMode,
    trafficRatio: event.trafficRatio,
    runConfig: event.runConfig,
    variableMapping: event.variableMapping,
    outputMapping: event.outputMapping,
    filterRules: event.filterRules,
    recordMode: event.recordMode,
    externalIdField: event.externalIdField,
    retentionDays: event.retentionDays,
    sourceExperimentId: event.sourceExperimentId,
    submitReason: event.submitReason,
    metrics: event.metrics,
    totalReceived: event.totalReceived,
    totalProcessed: event.totalProcessed,
    totalFiltered: event.totalFiltered,
    totalCorrect: event.totalCorrect,
    totalErrors: event.totalErrors,
    controlState: event.controlState,
    controlStatePayload: event.controlStatePayload,
    startedAt: event.startedAt ? new Date(event.startedAt) : null,
    finishedAt: event.finishedAt ? new Date(event.finishedAt) : null,
    createdBy: event.createdBy,
  };
}

function promotionSubmitReason(line: ReleaseLineDto): string {
  const currentProductionReason = normalizePromotionSubmitReason(line.currentProductionEvent?.submitReason);
  if (currentProductionReason) return currentProductionReason;

  const lineName = line.name.trim();
  const lineDescription = line.description?.trim();
  return lineDescription ? `${lineName}\n${lineDescription}` : lineName;
}

function normalizePromotionSubmitReason(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';

  const normalized = stripLegacyCanaryPromotionPrefix(trimmed);
  return isGenericPromotionSubmitReason(normalized) ? '' : normalized;
}

function stripLegacyCanaryPromotionPrefix(value: string): string {
  return value.replace(/^灰度候选\s*100%\s*接管[：:]\s*/u, '').trim();
}

function isGenericPromotionSubmitReason(value: string): boolean {
  return value.split('\n')[0]?.trim().toLowerCase() === 'promote canary 100%';
}

function resetRuntimeStats(snapshot: ReleaseLineMirrorSnapshot): ReleaseLineMirrorSnapshot {
  return {
    ...snapshot,
    metrics: null,
    totalReceived: 0,
    totalProcessed: 0,
    totalFiltered: 0,
    totalCorrect: 0,
    totalErrors: 0,
  };
}

function releaseLineIdentityCondition(identity: ReleaseLineIdentity) {
  if (identity.inputConnectorId) return eq(releaseLines.inputConnectorId, identity.inputConnectorId);
  if (identity.promptId)
    return and(isNull(releaseLines.inputConnectorId), eq(releaseLines.promptId, identity.promptId));
  return isNull(releaseLines.inputConnectorId);
}
