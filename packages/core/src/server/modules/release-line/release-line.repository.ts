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
  ReleaseLineRecordModeDto,
  ReleaseLineStatusDto,
  ReleaseVersionKindDto,
  UpdateReleaseLineInputRouteInputDto,
  UpdateReleaseLineOutputRouteInputDto,
  UpdateReleaseLineRunConfigInputDto,
} from '@proofhound/shared';
import { DATABASE_CLIENT } from '../../../shared/database/database.constants';

const { annotationTasks, connectors, models, projects, prompts, releaseLineEvents, releaseLines, releaseVersions } =
  schema;

type ReleaseLineRow = typeof releaseLines.$inferSelect;
type ReleaseLineEventRow = typeof releaseLineEvents.$inferSelect;
type ReleaseLineEventInsert = typeof releaseLineEvents.$inferInsert;
type ReleaseVersionRow = typeof releaseVersions.$inferSelect;
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

export interface ReleaseLineDeletionImpactRow {
  id: string;
  name: string | null;
  status: string | null;
  detail: string | null;
  createdAt: Date | null;
}

export interface ReleaseLineDeletionImpactRows {
  line: { id: string; name: string };
  events: ReleaseLineDeletionImpactRow[];
  versions: ReleaseLineDeletionImpactRow[];
  annotationTasks: ReleaseLineDeletionImpactRow[];
  runResults: number;
}

export interface ReleaseLineHardDeleteResult {
  deleted: number;
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
  recordMode: ReleaseLineRecordModeDto;
  recordCategories: string[];
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
  releaseVersionId?: string | null;
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

  async findEventById(
    projectId: string,
    releaseLineId: string,
    eventId: string,
  ): Promise<ReleaseLineEventDto | null> {
    const rows = await this.db
      .select()
      .from(releaseLineEvents)
      .where(
        and(
          eq(releaseLineEvents.projectId, projectId),
          eq(releaseLineEvents.releaseLineId, releaseLineId),
          eq(releaseLineEvents.id, eventId),
        ),
      )
      .limit(1);
    const hydrated = await this.hydrateEvents(rows);
    return hydrated[0] ?? null;
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

      if (snapshot.laneType === 'production' && productionOperationReleasesCanarySlot(snapshot.operation)) {
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

      const releaseVersion = await this.resolveReleaseVersion(tx, line.id, snapshot, now);
      const eventValues = await this.buildEventInsert(
        snapshot,
        line.id,
        supersedesEventId,
        releaseVersion?.id ?? null,
        now,
      );
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
      return this.promoteCanaryEvent(line, canary, actorUserId);
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

  async promoteActiveCanary(
    projectId: string,
    releaseLineId: string,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    const canary = line?.activeCanaryEvent;
    if (!line || !canary || canary.status !== 'running') return null;
    return this.promoteCanaryEvent(line, canary, actorUserId);
  }

  async stopLine(
    projectId: string,
    releaseLineId: string,
    reason: string,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    if (!line || line.status === 'archived') return null;

    const runningProduction = line.currentProductionEvent?.status === 'running' ? line.currentProductionEvent : null;
    const runningCanary = line.activeCanaryEvent?.status === 'running' ? line.activeCanaryEvent : null;
    if (!runningProduction && !runningCanary) return null;

    const now = new Date();
    if (runningProduction) {
      const stopped = await this.record(
        resetRuntimeStats({
          ...eventDtoToSnapshot(line, runningProduction),
          operation: 'force_stop',
          status: 'stopped',
          terminalReason: 'force_stopped',
          submitReason: reason,
          createdBy: actorUserId,
          createdAt: now,
          updatedAt: now,
          legacySource: null,
          legacySourceId: null,
        }),
      );
      await this.clearPromptProductionVersion(runningProduction.promptId);
      return this.findById(projectId, stopped.id);
    }

    if (!runningCanary) return null;
    const stopped = await this.record(
      resetRuntimeStats({
        ...eventDtoToSnapshot(line, runningCanary),
        operation: 'stop_lane',
        status: 'stopped',
        terminalReason: null,
        supersedesEventId: runningCanary.id,
        submitReason: reason,
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
        legacySource: null,
        legacySourceId: null,
      }),
    );
    return this.findById(projectId, stopped.id);
  }

  async startLine(
    projectId: string,
    releaseLineId: string,
    reason: string | undefined,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    if (!line || line.status !== 'stopped') return null;

    const resumableEvents = findResumableEvents(line);
    if (resumableEvents.length === 0) return null;

    const now = new Date();
    let started: ReleaseLineDto | null = null;
    for (const resumable of resumableEvents) {
      started = await this.record(
        resetRuntimeStats({
          ...eventDtoToSnapshot(line, resumable),
          operation: 'resume_lane',
          status: 'running',
          terminalReason: null,
          supersedesEventId: resumable.id,
          submitReason: reason ?? 'start release line',
          controlState: null,
          controlStatePayload: null,
          startedAt: now,
          finishedAt: null,
          createdBy: actorUserId,
          createdAt: now,
          updatedAt: now,
          legacySource: null,
          legacySourceId: null,
        }),
      );
      if (resumable.laneType === 'production') {
        await this.setPromptProductionVersion(projectId, resumable.promptId, resumable.promptVersionId);
      }
    }
    return this.findById(projectId, started?.id ?? releaseLineId);
  }

  async archiveLine(
    projectId: string,
    releaseLineId: string,
    reason: string | undefined,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    if (!line) return null;
    if (line.status === 'archived') return line;

    const hasRunningLane =
      line.currentProductionEvent?.status === 'running' || line.activeCanaryEvent?.status === 'running';
    if (hasRunningLane) return null;

    const slotEvents = findVisibleSlotEvents(line);
    const fallbackEvent = line.latestEvent ?? line.activeCanaryEvent ?? line.currentProductionEvent ?? null;
    const archiveTargets = slotEvents.length > 0 || !fallbackEvent ? slotEvents : [fallbackEvent];
    const now = new Date();
    await this.db.transaction(async (tx) => {
      let currentProductionEventId = line.currentProductionEventId;
      let activeCanaryEventId = line.activeCanaryEventId;
      for (const target of archiveTargets) {
        const eventValues = await this.buildEventInsert(
          {
            ...eventDtoToSnapshot(line, target),
            operation: 'archive_line',
            status: 'archived',
            terminalReason: 'archived',
            supersedesEventId: target.id,
            submitReason: reason ?? 'archive release line',
            controlState: null,
            controlStatePayload: null,
            finishedAt: now,
            createdBy: actorUserId,
            createdAt: now,
            updatedAt: now,
            legacySource: null,
            legacySourceId: null,
          },
          line.id,
          target.id,
          target.releaseVersionId,
          now,
        );
        const inserted = await tx.insert(releaseLineEvents).values(eventValues).returning({ id: releaseLineEvents.id });
        const archivedEventId = inserted[0]?.id ?? null;
        if (target.laneType === 'production') currentProductionEventId = archivedEventId;
        if (target.laneType === 'canary') activeCanaryEventId = archivedEventId;
      }
      await tx
        .update(releaseLines)
        .set({ status: 'archived', currentProductionEventId, activeCanaryEventId, archivedAt: now, updatedAt: now })
        .where(and(eq(releaseLines.projectId, projectId), eq(releaseLines.id, releaseLineId)));
    });
    return this.findById(projectId, releaseLineId);
  }

  async unarchiveLine(
    projectId: string,
    releaseLineId: string,
    reason: string | undefined,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    if (!line || line.status !== 'archived') return null;

    const slotEvents = findArchivedSlotEvents(line);
    const fallbackEvent = line.latestEvent ?? line.activeCanaryEvent ?? line.currentProductionEvent ?? null;
    const restoreTargets = slotEvents.length > 0 || !fallbackEvent ? slotEvents : [fallbackEvent];
    const now = new Date();
    if (restoreTargets.length === 0) {
      await this.db
        .update(releaseLines)
        .set({ status: 'stopped', archivedAt: null, updatedAt: now })
        .where(and(eq(releaseLines.projectId, projectId), eq(releaseLines.id, releaseLineId)));
      return this.findById(projectId, releaseLineId);
    }

    let restored: ReleaseLineDto | null = null;
    for (const target of restoreTargets) {
      restored = await this.record(
        resetRuntimeStats({
          ...eventDtoToSnapshot(line, target),
          operation: 'unarchive_line',
          status: 'stopped',
          terminalReason: null,
          supersedesEventId: target.id,
          submitReason: reason ?? 'unarchive release line',
          controlState: null,
          controlStatePayload: null,
          finishedAt: now,
          createdBy: actorUserId,
          createdAt: now,
          updatedAt: now,
          legacySource: null,
          legacySourceId: null,
        }),
      );
    }
    return this.findById(projectId, restored?.id ?? releaseLineId);
  }

  async restoreHistoryToLane(
    projectId: string,
    releaseLineId: string,
    sourceEventId: string,
    targetLaneType: ReleaseLineLaneTypeDto,
    reason: string | undefined,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    if (!line || line.status === 'archived') return null;
    const source = await this.findEventById(projectId, releaseLineId, sourceEventId);
    if (!source || !source.promptVersionId || !source.modelId) return null;

    const currentCanary = line.activeCanaryEvent;
    const status: ReleaseLineEventStatusDto = line.status === 'running' ? 'running' : 'stopped';
    const now = new Date();
    const restored = await this.record(
      resetRuntimeStats({
        ...eventDtoToSnapshot(line, source),
        laneType: targetLaneType,
        operation: targetLaneType === 'production' ? 'restore_to_production' : 'restore_to_canary',
        status,
        terminalReason: null,
        releaseVersionId: null,
        sourceEventId: source.id,
        supersedesEventId:
          targetLaneType === 'production' ? line.currentProductionEvent?.id : line.activeCanaryEvent?.id,
        rollbackTargetEventId: targetLaneType === 'production' ? source.id : null,
        trafficMode:
          targetLaneType === 'canary' ? (source.trafficMode ?? currentCanary?.trafficMode ?? 'split') : null,
        trafficRatio:
          targetLaneType === 'canary' ? (source.trafficRatio ?? currentCanary?.trafficRatio ?? 0.1) : null,
        submitReason:
          reason ??
          (targetLaneType === 'production'
            ? 'restore history to production slot'
            : 'restore history to canary slot'),
        controlState: null,
        controlStatePayload: null,
        startedAt: status === 'running' ? now : null,
        finishedAt: null,
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
        legacySource: null,
        legacySourceId: null,
      }),
    );

    if (targetLaneType === 'production' && status === 'running') {
      await this.setPromptProductionVersion(projectId, source.promptId, source.promptVersionId);
    }
    return this.findById(projectId, restored.id);
  }

  async listDeletionImpact(projectId: string, releaseLineId: string): Promise<ReleaseLineDeletionImpactRows | null> {
    const lineRows = await this.db
      .select({ id: releaseLines.id, name: releaseLines.name })
      .from(releaseLines)
      .where(and(eq(releaseLines.projectId, projectId), eq(releaseLines.id, releaseLineId)))
      .limit(1);
    const line = lineRows[0];
    if (!line) return null;

    const eventRows = await this.db
      .select({
        id: releaseLineEvents.id,
        operation: releaseLineEvents.operation,
        laneType: releaseLineEvents.laneType,
        status: releaseLineEvents.status,
        createdAt: releaseLineEvents.createdAt,
      })
      .from(releaseLineEvents)
      .where(and(eq(releaseLineEvents.projectId, projectId), eq(releaseLineEvents.releaseLineId, releaseLineId)))
      .orderBy(desc(releaseLineEvents.createdAt));

    const versionRows = await this.db
      .select()
      .from(releaseVersions)
      .where(and(eq(releaseVersions.projectId, projectId), eq(releaseVersions.releaseLineId, releaseLineId)))
      .orderBy(releaseVersions.targetProductionVersionNumber, releaseVersions.kind, releaseVersions.candidateNumber);

    const taskRows = await this.db
      .select({
        id: annotationTasks.id,
        name: annotationTasks.name,
        status: annotationTasks.status,
        scope: annotationTasks.scope,
        createdAt: annotationTasks.createdAt,
      })
      .from(annotationTasks)
      .where(sql`
        ${annotationTasks.releaseLineEventId} IN (
          SELECT id FROM ph_releases.release_line_events
          WHERE project_id = ${projectId}::uuid AND release_line_id = ${releaseLineId}::uuid
        )
        OR ${annotationTasks.releaseVersionId} IN (
          SELECT id FROM ph_releases.release_versions
          WHERE project_id = ${projectId}::uuid AND release_line_id = ${releaseLineId}::uuid
        )
      `)
      .orderBy(desc(annotationTasks.createdAt));

    const runResultRows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM ph_runs.run_results rr
      WHERE rr.project_id = ${projectId}::uuid
        AND rr.source = 'release'
        AND (
          rr.source_id IN (
            SELECT id FROM ph_releases.release_line_events
            WHERE project_id = ${projectId}::uuid AND release_line_id = ${releaseLineId}::uuid
          )
          OR rr.release_version_id IN (
            SELECT id FROM ph_releases.release_versions
            WHERE project_id = ${projectId}::uuid AND release_line_id = ${releaseLineId}::uuid
          )
        )
    `);
    const runResults = Number(unwrapRows<Record<string, unknown>>(runResultRows)[0]?.['count'] ?? 0);

    return {
      line,
      events: eventRows.map((row) => ({
        id: row.id,
        name: row.operation,
        status: row.status,
        detail: row.laneType,
        createdAt: row.createdAt,
      })),
      versions: versionRows.map((row) => ({
        id: row.id,
        name: formatReleaseVersionLabel(row),
        status: row.kind,
        detail: row.promptName,
        createdAt: row.createdAt,
      })),
      annotationTasks: taskRows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        detail: row.scope,
        createdAt: row.createdAt,
      })),
      runResults,
    };
  }

  /**
   * Force-stop every running lane of a release line and drop it out of the runner's runnable set,
   * committed in its OWN transaction ahead of hardDeleteLine. Once the line's slot events are no longer
   * 'running', the next runner scan's findRunnableLine returns null and stops dispatching — a best-effort
   * barrier before the physical delete. A residual LLM job already enqueued before this call may still
   * write a run result; hardDeleteLine's cascade removes those, and any landing after deletion either fail
   * the run_results.release_version_id FK or leave a harmless orphan (permanent delete is a confirmed
   * dangerous action). Archived lines stay archived.
   */
  async forceStopRunningLanesForDelete(projectId: string, releaseLineId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();
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
            eq(releaseLineEvents.projectId, projectId),
            eq(releaseLineEvents.releaseLineId, releaseLineId),
            eq(releaseLineEvents.status, 'running'),
          ),
        );
      await tx
        .update(releaseLines)
        .set({
          status: sql`CASE WHEN ${releaseLines.status} = 'archived' THEN 'archived' ELSE 'stopped' END`,
          updatedAt: now,
        })
        .where(and(eq(releaseLines.projectId, projectId), eq(releaseLines.id, releaseLineId)));
    });
  }

  async hardDeleteLine(projectId: string, releaseLineId: string): Promise<ReleaseLineHardDeleteResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        WITH target_events AS (
          SELECT id, prompt_id, prompt_version_id
          FROM ph_releases.release_line_events
          WHERE project_id = ${projectId}::uuid
            AND release_line_id = ${releaseLineId}::uuid
        ),
        target_versions AS (
          SELECT id
          FROM ph_releases.release_versions
          WHERE project_id = ${projectId}::uuid
            AND release_line_id = ${releaseLineId}::uuid
        ),
        target_tasks AS (
          SELECT id
          FROM ph_releases.annotation_tasks
          WHERE release_line_event_id IN (SELECT id FROM target_events)
             OR release_version_id IN (SELECT id FROM target_versions)
        ),
        target_run_results AS (
          SELECT rr.id, rr.created_at
          FROM ph_runs.run_results rr
          WHERE rr.project_id = ${projectId}::uuid
            AND rr.source = 'release'
            AND (
              rr.source_id IN (SELECT id FROM target_events)
              OR rr.release_version_id IN (SELECT id FROM target_versions)
            )
        )
        DELETE FROM ph_runs.annotations annotation
        WHERE annotation.task_id IN (SELECT id FROM target_tasks)
           OR EXISTS (
             SELECT 1
             FROM target_run_results rr
             WHERE annotation.run_result_id = rr.id
               AND annotation.run_result_created_at = rr.created_at
           )
      `);

      await tx.execute(sql`
        WITH target_events AS (
          SELECT id
          FROM ph_releases.release_line_events
          WHERE project_id = ${projectId}::uuid
            AND release_line_id = ${releaseLineId}::uuid
        ),
        target_versions AS (
          SELECT id
          FROM ph_releases.release_versions
          WHERE project_id = ${projectId}::uuid
            AND release_line_id = ${releaseLineId}::uuid
        ),
        target_run_results AS (
          SELECT rr.id, rr.created_at
          FROM ph_runs.run_results rr
          WHERE rr.project_id = ${projectId}::uuid
            AND rr.source = 'release'
            AND (
              rr.source_id IN (SELECT id FROM target_events)
              OR rr.release_version_id IN (SELECT id FROM target_versions)
            )
        )
        DELETE FROM ph_runs.run_results rr
        USING target_run_results target
        WHERE rr.id = target.id
          AND rr.created_at = target.created_at
      `);

      await tx.execute(sql`
        WITH target_events AS (
          SELECT id, prompt_id, prompt_version_id
          FROM ph_releases.release_line_events
          WHERE project_id = ${projectId}::uuid
            AND release_line_id = ${releaseLineId}::uuid
        ),
        target_versions AS (
          SELECT id
          FROM ph_releases.release_versions
          WHERE project_id = ${projectId}::uuid
            AND release_line_id = ${releaseLineId}::uuid
        )
        UPDATE ph_assets.prompts prompt
        SET current_online_version_id = NULL,
            updated_at = NOW()
        WHERE prompt.project_id = ${projectId}::uuid
          AND prompt.current_online_version_id IN (
            SELECT prompt_version_id
            FROM target_events
            WHERE prompt_id = prompt.id
              AND prompt_version_id IS NOT NULL
          )
      `);

      await tx.execute(sql`
        WITH target_events AS (
          SELECT id
          FROM ph_releases.release_line_events
          WHERE project_id = ${projectId}::uuid
            AND release_line_id = ${releaseLineId}::uuid
        ),
        target_versions AS (
          SELECT id
          FROM ph_releases.release_versions
          WHERE project_id = ${projectId}::uuid
            AND release_line_id = ${releaseLineId}::uuid
        )
        DELETE FROM ph_releases.annotation_tasks task
        WHERE task.release_line_event_id IN (SELECT id FROM target_events)
           OR task.release_version_id IN (SELECT id FROM target_versions)
      `);

      await tx
        .delete(releaseLineEvents)
        .where(and(eq(releaseLineEvents.projectId, projectId), eq(releaseLineEvents.releaseLineId, releaseLineId)));
      await tx
        .delete(releaseVersions)
        .where(and(eq(releaseVersions.projectId, projectId), eq(releaseVersions.releaseLineId, releaseLineId)));
      const deleted = await tx
        .delete(releaseLines)
        .where(and(eq(releaseLines.projectId, projectId), eq(releaseLines.id, releaseLineId)))
        .returning({ id: releaseLines.id });
      return { deleted: deleted.length };
    });
  }

  private async promoteCanaryEvent(
    line: ReleaseLineDto,
    canary: ReleaseLineEventDto,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
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
    return this.findById(line.projectId, promoted.id);
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
    const nextRunConfig = inheritCanaryStopConditions(input.laneType, event.runConfig, input.runConfig);
    const releaseVersionId =
      nextModel || hasTemperatureChanged(event.runConfig, nextRunConfig) ? null : event.releaseVersionId;

    const updated = await this.record(
      resetRuntimeStats({
        ...eventDtoToSnapshot(line, event),
        releaseVersionId,
        operation: 'config_changed',
        terminalReason: null,
        supersedesEventId: event.id,
        modelId: nextModel?.id ?? event.modelId,
        modelName: nextModel?.name ?? event.modelName,
        modelProvider: nextModel?.providerType ?? event.modelProvider,
        runConfig: nextRunConfig,
        recordMode: input.recordMode ?? event.recordMode,
        recordCategories: normalizeRecordCategoriesForMode(
          input.recordMode ?? event.recordMode,
          input.recordCategories ?? event.recordCategories,
        ),
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

  async updateActiveLaneOutputRoute(
    projectId: string,
    releaseLineId: string,
    input: UpdateReleaseLineOutputRouteInputDto,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    if (!line) return null;

    const event = input.laneType === 'production' ? line.currentProductionEvent : line.activeCanaryEvent;
    if (!event) return null;
    if (event.status !== 'running' && event.status !== 'stopped') return null;

    const now = new Date();
    const outputMappingChanged = JSON.stringify(event.outputMapping ?? []) !== JSON.stringify(input.outputMapping);
    const updated = await this.record(
      resetRuntimeStats({
        ...eventDtoToSnapshot(line, event),
        releaseVersionId: outputMappingChanged ? null : event.releaseVersionId,
        operation: 'config_changed',
        terminalReason: null,
        supersedesEventId: event.id,
        outputConnectorIds: input.outputConnectorIds,
        outputMapping: input.outputMapping,
        submitReason: input.laneType === 'production' ? '正式发布输出路由变更' : '灰度发布输出路由变更',
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
        legacySource: null,
        legacySourceId: null,
      }),
    );
    return this.findById(projectId, updated.id);
  }

  async updateActiveLaneInputRoute(
    projectId: string,
    releaseLineId: string,
    input: UpdateReleaseLineInputRouteInputDto,
    actorUserId: string,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    if (!line) return null;

    const event = input.laneType === 'production' ? line.currentProductionEvent : line.activeCanaryEvent;
    if (!event) return null;
    if (event.status !== 'running' && event.status !== 'stopped') return null;

    const now = new Date();
    const variableMappingChanged =
      JSON.stringify(event.variableMapping ?? {}) !== JSON.stringify(input.variableMapping);
    const externalIdFieldChanged = (event.externalIdField ?? '') !== input.externalIdField;
    const updated = await this.record(
      resetRuntimeStats({
        ...eventDtoToSnapshot(line, event),
        releaseVersionId: variableMappingChanged || externalIdFieldChanged ? null : event.releaseVersionId,
        operation: 'config_changed',
        terminalReason: null,
        supersedesEventId: event.id,
        variableMapping: input.variableMapping,
        filterRules: input.filterRules,
        externalIdField: input.externalIdField,
        submitReason: input.laneType === 'production' ? '正式发布输入路由变更' : '灰度发布输入路由变更',
        createdBy: actorUserId,
        createdAt: now,
        updatedAt: now,
        legacySource: null,
        legacySourceId: null,
      }),
    );
    return this.findById(projectId, updated.id);
  }

  async updateCurrentProductionRetention(
    projectId: string,
    releaseLineId: string,
    retentionDays: number | null,
  ): Promise<ReleaseLineDto | null> {
    const line = await this.findById(projectId, releaseLineId);
    const event = line?.currentProductionEvent;
    if (!event) return null;
    if (event.status !== 'running' && event.status !== 'stopped') return null;

    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(releaseLineEvents)
        .set({ retentionDays, updatedAt: now })
        .where(
          and(
            eq(releaseLineEvents.id, event.id),
            eq(releaseLineEvents.projectId, projectId),
            eq(releaseLineEvents.releaseLineId, releaseLineId),
            eq(releaseLineEvents.laneType, 'production'),
            inArray(releaseLineEvents.status, ['running', 'stopped']),
          ),
        )
        .returning({ id: releaseLineEvents.id });
      if (rows.length === 0) return false;
      await tx
        .update(releaseLines)
        .set({ updatedAt: now })
        .where(and(eq(releaseLines.projectId, projectId), eq(releaseLines.id, releaseLineId)));
      return true;
    });

    return updated ? this.findById(projectId, releaseLineId) : null;
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

  private async clearPromptProductionVersion(promptId: string | null): Promise<void> {
    if (!promptId) return;
    await this.db
      .update(prompts)
      .set({ currentOnlineVersionId: null, updatedAt: new Date() })
      .where(eq(prompts.id, promptId));
  }

  private async setPromptProductionVersion(
    projectId: string,
    promptId: string | null,
    promptVersionId: string | null,
  ): Promise<void> {
    if (!promptId || !promptVersionId) return;
    await this.db
      .update(prompts)
      .set({ currentOnlineVersionId: promptVersionId, updatedAt: new Date() })
      .where(and(eq(prompts.projectId, projectId), eq(prompts.id, promptId)));
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
    const versionRows = await this.db
      .select()
      .from(releaseVersions)
      .where(
        inArray(
          releaseVersions.releaseLineId,
          lines.map((line) => line.id),
        ),
      )
      .orderBy(releaseVersions.targetProductionVersionNumber, releaseVersions.kind, releaseVersions.candidateNumber);
    const hydratedEvents = await this.hydrateEvents([...latestRows, ...explicitEvents]);
    const eventById = new Map(hydratedEvents.map((event) => [event.id, event]));
    const latestByLine = new Map<string, ReleaseLineEventDto>();
    for (const event of hydratedEvents) {
      if (!latestByLine.has(event.releaseLineId)) latestByLine.set(event.releaseLineId, event);
    }
    const versionsByLine = new Map<string, ReturnType<typeof toReleaseVersionDto>[]>();
    for (const version of versionRows) {
      const list = versionsByLine.get(version.releaseLineId) ?? [];
      list.push(toReleaseVersionDto(version));
      versionsByLine.set(version.releaseLineId, list);
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
        versions: versionsByLine.get(line.id) ?? [],
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
    const versionIds = new Set<string>();
    for (const row of rows) {
      eventIds.add(row.id);
      for (const id of row.outputConnectorIds ?? []) outputIds.add(id);
      if (row.sourceEventId) sourceEventIds.add(row.sourceEventId);
      if (row.releaseVersionId) versionIds.add(row.releaseVersionId);
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
    const versionMap = new Map<string, ReleaseVersionRow>();
    if (versionIds.size > 0) {
      const versionRows = await this.db
        .select()
        .from(releaseVersions)
        .where(inArray(releaseVersions.id, Array.from(versionIds)));
      for (const version of versionRows) versionMap.set(version.id, version);
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
      const version = row.releaseVersionId ? (versionMap.get(row.releaseVersionId) ?? null) : null;
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
        releaseVersionId: row.releaseVersionId,
        releaseVersionKind: (version?.kind as ReleaseVersionKindDto | undefined) ?? null,
        releaseVersionLabel: version ? formatReleaseVersionLabel(version) : null,
        releaseVersionProductionNumber: version?.productionVersionNumber ?? null,
        releaseVersionTargetProductionNumber: version?.targetProductionVersionNumber ?? null,
        releaseVersionCandidateNumber: version?.candidateNumber ?? null,
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
        recordCategories: row.recordCategories ?? [],
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
        status: snapshot.status === 'running' ? 'running' : 'stopped',
        createdBy: snapshot.createdBy,
        createdAt: snapshot.createdAt ?? now,
        updatedAt: now,
      })
      .returning();
    const line = inserted[0];
    if (!line) throw new Error('release_lines insert returned no row');
    return line;
  }

  private async resolveReleaseVersion(
    tx: ReleaseLineDbExecutor,
    releaseLineId: string,
    snapshot: ReleaseLineMirrorSnapshot,
    now: Date,
  ): Promise<ReleaseVersionRow | null> {
    if (!snapshot.promptVersionId || !snapshot.modelId) return null;

    if (shouldReuseReleaseVersion(snapshot) && snapshot.releaseVersionId) {
      const existing = await tx
        .select()
        .from(releaseVersions)
        .where(eq(releaseVersions.id, snapshot.releaseVersionId))
        .limit(1);
      if (existing[0]) return existing[0];
    }

    const promotedFromReleaseVersionId =
      snapshot.operation === 'promote_canary'
        ? (snapshot.releaseVersionId ?? (await this.findEventReleaseVersionId(tx, snapshot.sourceEventId)))
        : null;

    return this.createReleaseVersion(tx, releaseLineId, snapshot, promotedFromReleaseVersionId, now);
  }

  private async createReleaseVersion(
    tx: ReleaseLineDbExecutor,
    releaseLineId: string,
    snapshot: ReleaseLineMirrorSnapshot,
    promotedFromReleaseVersionId: string | null,
    now: Date,
  ): Promise<ReleaseVersionRow | null> {
    if (!snapshot.promptVersionId || !snapshot.modelId) return null;

    const kind: ReleaseVersionKindDto = snapshot.laneType === 'canary' ? 'candidate' : 'production';
    const maxProductionRows = await tx
      .select({
        maxProductionVersionNumber: sql<number | null>`MAX(${releaseVersions.productionVersionNumber})::int`,
      })
      .from(releaseVersions)
      .where(and(eq(releaseVersions.releaseLineId, releaseLineId), eq(releaseVersions.kind, 'production')));
    const nextProductionVersionNumber = Number(maxProductionRows[0]?.maxProductionVersionNumber ?? 0) + 1;

    const targetProductionVersionNumber =
      kind === 'production'
        ? nextProductionVersionNumber
        : Number(maxProductionRows[0]?.maxProductionVersionNumber ?? 0) + 1;

    const candidateNumber =
      kind === 'candidate' ? await this.nextCandidateNumber(tx, releaseLineId, targetProductionVersionNumber) : null;

    const inserted = await tx
      .insert(releaseVersions)
      .values({
        projectId: snapshot.projectId,
        releaseLineId,
        kind,
        productionVersionNumber: kind === 'production' ? nextProductionVersionNumber : null,
        targetProductionVersionNumber,
        candidateNumber,
        promotedFromReleaseVersionId,
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

  private async nextCandidateNumber(
    tx: ReleaseLineDbExecutor,
    releaseLineId: string,
    targetProductionVersionNumber: number,
  ): Promise<number> {
    const maxCandidateRows = await tx
      .select()
      .from(releaseVersions)
      .where(
        and(
          eq(releaseVersions.releaseLineId, releaseLineId),
          eq(releaseVersions.kind, 'candidate'),
          eq(releaseVersions.targetProductionVersionNumber, targetProductionVersionNumber),
        ),
      );
    const maxCandidateNumber = maxCandidateRows.reduce((max, row) => Math.max(max, row.candidateNumber ?? 0), 0);
    return maxCandidateNumber + 1;
  }

  private async findEventReleaseVersionId(
    tx: ReleaseLineDbExecutor,
    eventId: string | null | undefined,
  ): Promise<string | null> {
    if (!eventId) return null;
    const rows = await tx
      .select({ releaseVersionId: releaseLineEvents.releaseVersionId })
      .from(releaseLineEvents)
      .where(eq(releaseLineEvents.id, eventId))
      .limit(1);
    return rows[0]?.releaseVersionId ?? null;
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
    releaseVersionId: string | null,
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
      releaseVersionId,
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
      recordCategories: normalizeRecordCategoriesForMode(snapshot.recordMode, snapshot.recordCategories),
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
    const lineRows = await tx
      .select({ status: releaseLines.status, archivedAt: releaseLines.archivedAt })
      .from(releaseLines)
      .where(eq(releaseLines.id, releaseLineId))
      .limit(1);
    const productionRows = await tx
      .select({ id: releaseLineEvents.id, status: releaseLineEvents.status })
      .from(releaseLineEvents)
      .where(
        and(
          eq(releaseLineEvents.releaseLineId, releaseLineId),
          eq(releaseLineEvents.laneType, 'production'),
          sql`${releaseLineEvents.status} IN ('running', 'stopped', 'archived')`,
        ),
      )
      .orderBy(desc(releaseLineEvents.createdAt))
      .limit(1);
    const canaryRows = await tx
      .select({ id: releaseLineEvents.id, status: releaseLineEvents.status })
      .from(releaseLineEvents)
      .where(
        and(
          eq(releaseLineEvents.releaseLineId, releaseLineId),
          eq(releaseLineEvents.laneType, 'canary'),
          sql`${releaseLineEvents.status} IN ('running', 'stopped', 'archived')`,
        ),
      )
      .orderBy(desc(releaseLineEvents.createdAt))
      .limit(1);
    const currentProductionEventId = productionRows[0]?.id ?? null;
    const activeCanaryEventId = canaryRows[0]?.id ?? null;
    // Mirror release-runner.repository.refreshLinePointersByEvent: an archived line is
    // non-runnable and must NEVER be silently resurrected by a new mirror event. The only
    // legitimate departure from 'archived' is an explicit unarchive (operation 'unarchive_line',
    // which records a 'stopped' event); every other event leaves status/archivedAt untouched.
    const lineCurrentlyArchived = (lineRows[0]?.status ?? null) === 'archived' && event.operation !== 'unarchive_line';
    const status = lineCurrentlyArchived
      ? 'archived'
      : lineStatus(productionRows[0]?.status ?? null, canaryRows[0]?.status ?? null);
    const archivedAt = lineCurrentlyArchived ? (lineRows[0]?.archivedAt ?? null) : null;
    await tx
      .update(releaseLines)
      .set({
        currentProductionEventId,
        activeCanaryEventId,
        status,
        updatedAt: now,
        archivedAt,
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

function lineStatus(productionStatus: string | null, activeCanaryStatus: string | null): ReleaseLineStatusDto {
  if (productionStatus === 'running' || activeCanaryStatus === 'running') return 'running';
  return 'stopped';
}

function findResumableEvents(line: ReleaseLineDto): ReleaseLineEventDto[] {
  const slotEvents = findVisibleSlotEvents(line).filter((event) => event.status === 'stopped');
  if (slotEvents.length > 0) return slotEvents;
  return line.latestEvent?.status === 'stopped' ? [line.latestEvent] : [];
}

function findVisibleSlotEvents(line: ReleaseLineDto): ReleaseLineEventDto[] {
  const events = [line.currentProductionEvent, line.activeCanaryEvent].filter(
    (event): event is ReleaseLineEventDto => Boolean(event),
  );
  return dedupeEvents(events);
}

function findArchivedSlotEvents(line: ReleaseLineDto): ReleaseLineEventDto[] {
  return findVisibleSlotEvents(line).filter((event) => event.status === 'archived');
}

function dedupeEvents(events: ReleaseLineEventDto[]): ReleaseLineEventDto[] {
  const seen = new Set<string>();
  const result: ReleaseLineEventDto[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return result;
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

function inheritCanaryStopConditions(
  laneType: ReleaseLineLaneTypeDto,
  previousRunConfig: unknown,
  nextRunConfig: unknown,
): Record<string, unknown> {
  const next = asRecord(nextRunConfig);
  if (laneType !== 'canary' || Object.prototype.hasOwnProperty.call(next, 'stopConditions')) return next;
  const previousStopConditions = asRecord(previousRunConfig)['stopConditions'];
  return previousStopConditions === undefined ? next : { ...next, stopConditions: previousStopConditions };
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

function formatReleaseVersionLabel(
  version: Pick<
    ReleaseVersionRow,
    'kind' | 'productionVersionNumber' | 'targetProductionVersionNumber' | 'candidateNumber'
  >,
) {
  if (version.kind === 'production')
    return `v${version.productionVersionNumber ?? version.targetProductionVersionNumber}`;
  const baseProductionNumber = Math.max(0, version.targetProductionVersionNumber - 1);
  return `v${baseProductionNumber}.${version.candidateNumber ?? 0}`;
}

function toReleaseVersionDto(version: ReleaseVersionRow) {
  const promptVersionNumber =
    version.promptVersionNumber ?? numberFromSnapshot(version.promptVersionSnapshot, 'versionNumber');
  return {
    id: version.id,
    projectId: version.projectId,
    releaseLineId: version.releaseLineId,
    kind: version.kind as ReleaseVersionKindDto,
    productionVersionNumber: version.productionVersionNumber,
    targetProductionVersionNumber: version.targetProductionVersionNumber,
    candidateNumber: version.candidateNumber,
    promotedFromReleaseVersionId: version.promotedFromReleaseVersionId,
    label: formatReleaseVersionLabel(version),
    promptId: version.promptId,
    promptName: version.promptName,
    promptVersionId: version.promptVersionId,
    promptVersionNumber,
    promptVersionLabel: promptVersionNumber ? `v${promptVersionNumber}` : null,
    promptSnapshot: asRecord(version.promptSnapshot),
    promptVersionSnapshot: asRecord(version.promptVersionSnapshot),
    modelId: version.modelId,
    modelName: stringFromSnapshot(version.modelSnapshot, 'name'),
    modelProvider:
      stringFromSnapshot(version.modelSnapshot, 'providerType') ??
      stringFromSnapshot(version.modelSnapshot, 'provider'),
    modelSnapshot: asRecord(version.modelSnapshot),
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  };
}

function mergeOutputConnectors(production: ReleaseLineEventDto | null, canary: ReleaseLineEventDto | null) {
  const map = new Map<string, { id: string; name: string; type: string }>();
  for (const connector of production?.outputConnectors ?? []) map.set(connector.id, connector);
  for (const connector of canary?.outputConnectors ?? []) map.set(connector.id, connector);
  return [...map.values()];
}

function normalizeRecordCategoriesForMode(mode: ReleaseLineRecordModeDto, categories: string[] | null | undefined) {
  if (mode === 'all') return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const category of categories ?? []) {
    const trimmed = category.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
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
    recordCategories: event.recordCategories,
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
    releaseVersionId: event.releaseVersionId,
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

function shouldReuseReleaseVersion(snapshot: ReleaseLineMirrorSnapshot): boolean {
  if (!snapshot.releaseVersionId) return false;
  return (
    [
      'traffic_updated',
      'mode_updated',
      'stop_lane',
      'resume_lane',
      'cancel_canary',
      'force_stop',
      'archive_line',
      'unarchive_line',
    ].includes(snapshot.operation) || snapshot.operation === 'config_changed'
  );
}

function productionOperationReleasesCanarySlot(operation: ReleaseLineEventOperationDto): boolean {
  return operation === 'rollback' || operation === 'restore_to_production';
}

function hasTemperatureChanged(previousRunConfig: unknown, nextRunConfig: unknown): boolean {
  const previous = asRecord(previousRunConfig)['temperature'];
  const next = asRecord(nextRunConfig)['temperature'];
  if (previous === undefined && next === undefined) return false;
  return Number(previous) !== Number(next);
}

function releaseLineIdentityCondition(identity: ReleaseLineIdentity) {
  if (identity.inputConnectorId) return eq(releaseLines.inputConnectorId, identity.inputConnectorId);
  if (identity.promptId)
    return and(isNull(releaseLines.inputConnectorId), eq(releaseLines.promptId, identity.promptId));
  return isNull(releaseLines.inputConnectorId);
}

function unwrapRows<T = unknown>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
    return ((result as { rows?: T[] }).rows ?? []) as T[];
  }
  return [];
}
