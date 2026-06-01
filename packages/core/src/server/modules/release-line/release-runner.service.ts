import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ConsumeMessage } from '@proofhound/connector-client';
import { createLogger } from '@proofhound/logger';
import type { ConnectorConfigShape, ConnectorDirection, ConnectorType } from '@proofhound/shared';
import { BullmqService } from '../../infrastructure/orchestration/bullmq.service';
import { RedisMutexService, type RedisMutexLease } from '../../../shared/redis/redis-mutex.service';
import { ConnectorDriverFactory } from '../connector/connector.driver-factory';
import {
  buildReleaseLlmPayload,
  buildReleaseOutputPayload,
  CanaryRuntimeInputError,
  computeReleaseRunResultId,
  mapCanaryVariables,
  matchesCanaryFilter,
  normalizeQueuePayload,
  passesTrafficRatio,
  readReleaseExternalId,
  type CanaryRuntimeConfig,
} from '../canary-release/canary-runtime';
import {
  ReleaseRunnerRepository,
  type ReleaseCompletedRunResultRow,
  type ReleaseOutputConnectorRow,
  type ReleaseRunnerLaneRow,
  type ReleaseRunnerLineRow,
} from './release-runner.repository';

const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_CONSUME_TIMEOUT_MS = 5_000;
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 500;
const DEFAULT_LOCK_TTL_MS = 60_000;
const MIN_LOCK_TTL_MS = 10_000;
const LOCK_KEY_PREFIX = 'proofhound:lock:release-runner';

interface ActiveReleaseTask {
  abortController: AbortController;
  lease: RedisMutexLease;
  renewTimer: NodeJS.Timeout;
  promise: Promise<void>;
}

@Injectable()
export class ReleaseRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('release-runner.service', { service: 'server' });
  private readonly active = new Map<string, ActiveReleaseTask>();
  private scanTimer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(
    private readonly repo: ReleaseRunnerRepository,
    private readonly driverFactory: ConnectorDriverFactory,
    private readonly bullmq: BullmqService,
    private readonly mutex: RedisMutexService,
  ) {}

  onModuleInit(): void {
    this.scanTimer = setInterval(() => {
      void this.scanOnce();
    }, this.getScanIntervalMs());
    void this.scanOnce();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    for (const task of this.active.values()) task.abortController.abort();
    await Promise.allSettled(Array.from(this.active.values()).map((task) => task.promise));
    this.active.clear();
  }

  async scanOnce(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const lines = await this.repo.listRunnableLines();
      const runningIds = new Set(lines.map((line) => line.id));

      for (const [releaseLineId] of this.active.entries()) {
        if (!runningIds.has(releaseLineId)) this.stopTask(releaseLineId);
      }

      for (const line of lines) {
        await this.syncCompletedResults(line);
        if (await this.applyControlState(line)) continue;
        if (line.inputConnectorType === 'webhook') continue;
        if (!this.active.has(line.id)) await this.startLineTask(line);
      }
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'release_runner_scan_failed');
    } finally {
      this.scanning = false;
    }
  }

  private async startLineTask(line: ReleaseRunnerLineRow): Promise<void> {
    const lease = await this.acquireLineLease(line.id);
    if (!lease) {
      this.logger.debug({ releaseLineId: line.id }, 'release_runner_lease_unavailable');
      return;
    }

    const abortController = new AbortController();
    const renewTimer = this.startLeaseRenewal(line.id, lease, abortController);
    const promise = this.consumeLine(line, abortController.signal).finally(async () => {
      clearInterval(renewTimer);
      const current = this.active.get(line.id);
      if (current?.abortController === abortController) this.active.delete(line.id);
      await this.releaseLease(line.id, lease);
    });
    this.active.set(line.id, { abortController, lease, renewTimer, promise });
    this.logger.info(
      { releaseLineId: line.id, connectorId: line.inputConnectorId, connectorType: line.inputConnectorType },
      'release_runner_started',
    );
  }

  private async consumeLine(line: ReleaseRunnerLineRow, signal: AbortSignal): Promise<void> {
    const result = await this.driverFactory.consume({
      configEncrypted: line.inputConnectorConfigEncrypted,
      type: line.inputConnectorType as ConnectorType,
      direction: line.inputConnectorDirection as ConnectorDirection,
      config: resolveInputConnectorConfig(line),
      batchSize: resolveBatchSize(line),
      timeoutMs: DEFAULT_CONSUME_TIMEOUT_MS,
      consumerName: `release-line-${line.id}`,
      signal,
      onMessage: (message) => this.handleQueueMessage(line, message),
    });
    if (result.error && !signal.aborted) {
      this.logger.error(
        { releaseLineId: line.id, connectorId: line.inputConnectorId, error: result.error },
        'release_runner_consume_failed',
      );
    }
  }

  private async handleQueueMessage(startupLine: ReleaseRunnerLineRow, message: ConsumeMessage): Promise<void> {
    const line = await this.repo.findRunnableLine(startupLine.id);
    if (!line) {
      this.stopTask(startupLine.id);
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = normalizeQueuePayload(message.payload);
    } catch (error) {
      await this.incrementFilteredForRunnableLanes(line);
      this.logger.warn(
        { releaseLineId: line.id, messageId: message.id, error: (error as Error).message },
        'release_runner_message_filtered_invalid_payload',
      );
      return;
    }

    const routingLane = line.canary ?? line.production;
    if (!routingLane) {
      await this.incrementFilteredForRunnableLanes(line);
      return;
    }

    let externalId: string;
    try {
      externalId = readReleaseExternalId(routingLane, payload);
    } catch (error) {
      await this.incrementFilteredForRunnableLanes(line);
      const code = error instanceof CanaryRuntimeInputError ? error.code : 'release_runtime_input_error';
      this.logger.warn(
        { releaseLineId: line.id, messageId: message.id, code },
        'release_runner_message_filtered_mapping',
      );
      return;
    }

    const selected = selectLanesForMessage(line, externalId);
    if (selected.length === 0) {
      await this.incrementFilteredForRunnableLanes(line);
      return;
    }

    for (const lane of selected) {
      await this.handleLaneMessage(lane, message.id, payload);
    }
  }

  private async handleLaneMessage(
    lane: ReleaseRunnerLaneRow,
    messageId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.repo.incrementReceived(lane.id);
    if (!matchesCanaryFilter(lane.filterRules, payload)) {
      await this.repo.incrementFiltered(lane.id);
      return;
    }

    let mapped: { externalId: string; inputVariables: Record<string, unknown> };
    try {
      mapped = mapCanaryVariables(lane, payload);
    } catch (error) {
      await this.repo.incrementFiltered(lane.id);
      const code = error instanceof CanaryRuntimeInputError ? error.code : 'release_runtime_input_error';
      this.logger.warn({ releaseLineEventId: lane.id, messageId, code }, 'release_runner_message_filtered_mapping');
      return;
    }

    const runResultId = computeReleaseRunResultId(lane.id, messageId);
    const llmPayload = buildReleaseLlmPayload({
      release: toRuntimeConfig(lane),
      inputVariables: mapped.inputVariables,
      rawPayload: payload,
      externalId: mapped.externalId,
      runResultId,
    });
    await this.bullmq.enqueueLlmJob(llmPayload, runResultId);
    this.logger.info(
      { releaseLineEventId: lane.id, lane: lane.laneType, messageId, runResultId },
      'release_runner_llm_job_enqueued',
    );
  }

  private async incrementFilteredForRunnableLanes(line: ReleaseRunnerLineRow): Promise<void> {
    const lanes = [line.production, line.canary].filter((lane): lane is ReleaseRunnerLaneRow => Boolean(lane));
    await Promise.all(lanes.map((lane) => this.repo.incrementFiltered(lane.id)));
  }

  private async syncCompletedResults(line: ReleaseRunnerLineRow): Promise<void> {
    for (const lane of [line.production, line.canary]) {
      if (!lane) continue;
      const attached = await this.repo.attachCompletedRunResults(lane.id);
      if (attached.length > 0) {
        this.logger.info(
          { releaseLineEventId: lane.id, lane: lane.laneType, completed: attached.length },
          'release_runner_results_collected',
        );
        if (lane.outputConnectorIds.length > 0) await this.pushCompletedResults(lane, attached);
      }
    }
  }

  private async pushCompletedResults(
    lane: ReleaseRunnerLaneRow,
    runResults: ReleaseCompletedRunResultRow[],
  ): Promise<void> {
    if (lane.outputConnectorIds.length === 0 || runResults.length === 0) return;
    const outputConnectors = await this.repo.listOutputConnectorsByIds(lane.projectId, lane.outputConnectorIds);
    this.logMissingOutputConnectors(lane, outputConnectors);

    const runtimeConfig = toRuntimeConfig(lane);
    const messages = runResults.map((runResult) =>
      buildReleaseOutputPayload({
        release: runtimeConfig,
        runResult,
      }),
    );

    let successCount = 0;
    let failedCount = this.countMissingOutputDeliveries(lane, outputConnectors, messages.length);

    if (outputConnectors.length === 0) {
      await this.repo.recordOutputDelivery(lane.id, { successCount, failedCount });
      return;
    }

    for (const connector of outputConnectors) {
      const result = await this.driverFactory.push({
        configEncrypted: connector.configEncrypted,
        type: connector.type as ConnectorType,
        direction: connector.direction as ConnectorDirection,
        config: connector.config as ConnectorConfigShape,
        messages,
      });
      if (result.error) {
        failedCount += messages.length;
        this.logger.error(
          {
            releaseLineEventId: lane.id,
            connectorId: connector.id,
            error: result.error,
            messageCount: messages.length,
          },
          'release_runner_output_push_failed',
        );
        continue;
      }
      const pushed = Math.min(messages.length, Math.max(0, Math.trunc(result.pushed)));
      successCount += pushed;
      failedCount += Math.max(0, messages.length - pushed);
      this.logger.info(
        { releaseLineEventId: lane.id, connectorId: connector.id, pushed },
        'release_runner_output_pushed',
      );
    }

    await this.repo.recordOutputDelivery(lane.id, { successCount, failedCount });
  }

  private logMissingOutputConnectors(lane: ReleaseRunnerLaneRow, outputConnectors: ReleaseOutputConnectorRow[]): void {
    const found = new Set(outputConnectors.map((connector) => connector.id));
    const missing = lane.outputConnectorIds.filter((id) => !found.has(id));
    if (missing.length === 0) return;
    this.logger.warn({ releaseLineEventId: lane.id, connectorIds: missing }, 'release_runner_output_connector_missing');
  }

  private countMissingOutputDeliveries(
    lane: ReleaseRunnerLaneRow,
    outputConnectors: ReleaseOutputConnectorRow[],
    messageCount: number,
  ): number {
    const found = new Set(outputConnectors.map((connector) => connector.id));
    const missingCount = lane.outputConnectorIds.filter((id) => !found.has(id)).length;
    return missingCount * messageCount;
  }

  private async applyControlState(line: ReleaseRunnerLineRow): Promise<boolean> {
    let handled = false;
    for (const lane of [line.production, line.canary]) {
      if (!lane?.controlState) continue;
      if (lane.controlState === 'stop') {
        await this.repo.transitionLaneStatus(lane.id, 'stopped', {
          terminalReason: lane.laneType === 'production' ? 'force_stopped' : null,
          clearControlState: true,
        });
        handled = true;
      } else if (lane.controlState === 'cancel') {
        await this.repo.transitionLaneStatus(lane.id, 'cancelled', {
          terminalReason: 'cancelled',
          clearControlState: true,
        });
        handled = true;
      } else if (lane.controlState === 'resume' || lane.controlState === 'extend') {
        await this.repo.clearControlState(lane.id);
      }
    }
    if (handled) this.stopTask(line.id);
    return handled;
  }

  private stopTask(releaseLineId: string): void {
    const task = this.active.get(releaseLineId);
    if (!task) return;
    task.abortController.abort();
  }

  private getScanIntervalMs(): number {
    const raw = Number(process.env['RELEASE_RUNNER_SCAN_INTERVAL_MS'] ?? process.env['CANARY_RUNNER_SCAN_INTERVAL_MS']);
    if (Number.isFinite(raw) && raw >= 1_000) return raw;
    return DEFAULT_SCAN_INTERVAL_MS;
  }

  private async acquireLineLease(releaseLineId: string): Promise<RedisMutexLease | null> {
    try {
      return await this.mutex.acquire({
        key: buildReleaseLineLockKey(releaseLineId),
        ttlMs: this.getLockTtlMs(),
      });
    } catch (error) {
      this.logger.error({ releaseLineId, error: (error as Error).message }, 'release_runner_lease_acquire_failed');
      return null;
    }
  }

  private startLeaseRenewal(
    releaseLineId: string,
    lease: RedisMutexLease,
    abortController: AbortController,
  ): NodeJS.Timeout {
    const renewTimer = setInterval(() => {
      void lease
        .renew()
        .then((renewed) => {
          if (renewed) return;
          this.logger.warn({ releaseLineId }, 'release_runner_lease_lost');
          abortController.abort();
        })
        .catch((error) => {
          this.logger.error({ releaseLineId, error: (error as Error).message }, 'release_runner_lease_renew_failed');
          abortController.abort();
        });
    }, resolveRenewIntervalMs(lease.ttlMs));
    renewTimer.unref?.();
    return renewTimer;
  }

  private async releaseLease(releaseLineId: string, lease: RedisMutexLease): Promise<void> {
    try {
      await lease.release();
    } catch (error) {
      this.logger.warn({ releaseLineId, error: (error as Error).message }, 'release_runner_lease_release_failed');
    }
  }

  private getLockTtlMs(): number {
    const raw = Number(process.env['RELEASE_RUNNER_LOCK_TTL_MS'] ?? process.env['CANARY_RUNNER_LOCK_TTL_MS']);
    if (Number.isFinite(raw) && raw >= MIN_LOCK_TTL_MS) return Math.floor(raw);
    return DEFAULT_LOCK_TTL_MS;
  }
}

export function buildReleaseLineLockKey(releaseLineId: string): string {
  return `${LOCK_KEY_PREFIX}:${releaseLineId}`;
}

function selectLanesForMessage(line: ReleaseRunnerLineRow, externalId: string): ReleaseRunnerLaneRow[] {
  const production = line.production;
  const canary = line.canary;
  if (!canary) return production ? [production] : [];

  const trafficRatio = canary.trafficRatio ?? 1;
  const canaryHit = passesTrafficRatio(canary.id, externalId, trafficRatio);
  const trafficMode = canary.trafficMode ?? 'split';

  if (!production) return canaryHit ? [canary] : [];
  if (trafficMode === 'dual_run') return canaryHit ? [production, canary] : [production];
  return canaryHit ? [canary] : [production];
}

function resolveRenewIntervalMs(ttlMs: number): number {
  return Math.max(1_000, Math.floor(ttlMs / 3));
}

function toRuntimeConfig(lane: ReleaseRunnerLaneRow): CanaryRuntimeConfig {
  return {
    id: lane.id,
    projectId: lane.projectId,
    releaseVariantId: lane.releaseVariantId,
    promptVersionId: lane.promptVersionId,
    promptId: lane.promptId,
    modelId: lane.modelId,
    variableMapping: lane.variableMapping,
    filterRules: lane.filterRules,
    externalIdField: lane.externalIdField,
    runConfig: lane.runConfig,
    promptBody: lane.promptBody,
    promptVariables: lane.promptVariables,
    promptOutputSchema: lane.promptOutputSchema,
    promptJudgmentRules: lane.promptJudgmentRules,
    promptLanguage: lane.promptLanguage,
    outputMapping: lane.outputMapping,
  };
}

function resolveBatchSize(line: ReleaseRunnerLineRow): number {
  const configs = [line.production?.runConfig, line.canary?.runConfig].filter(Boolean) as Array<
    Record<string, unknown>
  >;
  const configured = Math.max(
    ...configs.map((config) => Number(config['concurrency'])).filter((value) => Number.isFinite(value)),
    Number(line.inputConnectorConfig['batchSize']),
  );
  if (!Number.isFinite(configured)) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.max(Math.floor(configured), 1), MAX_BATCH_SIZE);
}

function resolveInputConnectorConfig(line: ReleaseRunnerLineRow): ConnectorConfigShape {
  const canary = line.canary;
  if (!canary || canary.trafficMode !== 'dual_run' || line.inputConnectorType !== 'kafka') {
    return line.inputConnectorConfig as ConnectorConfigShape;
  }
  return {
    ...line.inputConnectorConfig,
    consumerGroup: `proofhound-dual-run-${line.id}`,
  } as ConnectorConfigShape;
}
