import { Readable } from 'node:stream';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@proofhound/logger';
import type {
  ReleaseRunResultCleanupFilterDto,
  ReleaseRunResultCleanupImpactDto,
  ReleaseRunResultCleanupInputDto,
  ReleaseRunResultListResponseDto,
  RunResultDetailDto,
  RunResultExportFormatDto,
  RunResultListQueryDto,
  RunResultListResponseDto,
  RunResultReleaseListQueryDto,
} from '@proofhound/shared';
import type { ClassificationAggregateRow } from '@proofhound/metrics';
import { toActorContext } from '../../common/access-control';
import { AccessControlService } from '../../common/contracts/access-control.service';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RunResultRepository } from './run-result.repository';
import {
  type BatchTerminalCounts,
  type ReleaseRunResultExportItem,
  type RunResultExportCursor,
} from './run-result.repository';

const RUN_RESULT_EXPORT_BATCH_SIZE = 500;

export interface RunResultExportFile {
  fileName: string;
  contentType: string;
  stream: Readable;
}

@Injectable()
export class RunResultService {
  private readonly logger = createLogger('run-result.service', { service: 'server' });

  constructor(
    private readonly repo: RunResultRepository,
    private readonly accessControl: AccessControlService,
  ) {}

  aggregateExperiment(experimentId: string): Promise<ClassificationAggregateRow[]> {
    return this.repo.aggregateExperiment(experimentId);
  }

  aggregateExperimentLatency(experimentId: string) {
    return this.repo.aggregateExperimentLatency(experimentId);
  }

  countBatchTerminal(experimentId: string, runResultIds: string[]): Promise<BatchTerminalCounts> {
    return this.repo.countBatchTerminal(experimentId, runResultIds);
  }

  findBatchTerminalIds(experimentId: string, runResultIds: string[]): Promise<string[]> {
    return this.repo.findBatchTerminalIds(experimentId, runResultIds);
  }

  async listExperimentRunResults(
    projectId: string,
    experimentId: string,
    actor: CurrentUserPayload,
    query: RunResultListQueryDto,
  ): Promise<RunResultListResponseDto> {
    await this.assertExperimentAccessible(projectId, experimentId, actor);
    return this.repo.listByExperiment(experimentId, query);
  }

  async listReleaseRunResults(
    projectId: string,
    actor: CurrentUserPayload,
    query: RunResultReleaseListQueryDto,
  ): Promise<ReleaseRunResultListResponseDto> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    return this.repo.listByRelease(projectId, query);
  }

  async exportExperimentRunResults(
    projectId: string,
    experimentId: string,
    actor: CurrentUserPayload,
    format: RunResultExportFormatDto,
    query: RunResultListQueryDto,
  ): Promise<RunResultExportFile> {
    await this.assertExperimentAccessible(projectId, experimentId, actor);
    return {
      fileName: `experiment-run-results-${experimentId}.${format}`,
      contentType: contentTypeForRunResultExport(format),
      stream: Readable.from(this.streamExperimentRunResultExport(experimentId, format, query)),
    };
  }

  async exportReleaseRunResults(
    projectId: string,
    actor: CurrentUserPayload,
    format: RunResultExportFormatDto,
    query: RunResultReleaseListQueryDto,
  ): Promise<RunResultExportFile> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    return {
      fileName: `release-run-results-${projectId}.${format}`,
      contentType: contentTypeForRunResultExport(format),
      stream: Readable.from(this.streamReleaseRunResultExport(projectId, format, query)),
    };
  }

  async previewReleaseRunResultCleanup(
    projectId: string,
    actor: CurrentUserPayload,
    filter: ReleaseRunResultCleanupFilterDto,
  ): Promise<ReleaseRunResultCleanupImpactDto> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    this.assertCleanupVersionFilter(filter);
    return this.repo.previewReleaseCleanup(projectId, filter);
  }

  async cleanupReleaseRunResults(
    projectId: string,
    actor: CurrentUserPayload,
    input: ReleaseRunResultCleanupInputDto,
  ): Promise<ReleaseRunResultCleanupImpactDto> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'release_manage');
    this.assertCleanupVersionFilter(input);
    const impact = await this.repo.deleteReleaseCleanup(projectId, input);
    this.logger.info(
      {
        projectId,
        runResults: impact.runResults,
        annotations: impact.annotations,
        estimatedReclaimableBytes: impact.estimatedReclaimableBytes,
      },
      'release_run_results_cleanup_done',
    );
    return impact;
  }

  async sweepReleaseRunResultRetention(now = new Date()): Promise<{
    targets: number;
    runResults: number;
    estimatedReclaimableBytes: number;
  }> {
    const batch = await this.repo.deleteReleaseRetentionCleanupBatch(now);
    const summary = { targets: batch.targets, runResults: 0, estimatedReclaimableBytes: 0 };

    if (!batch.lockAcquired) {
      return summary;
    }

    for (const cleanup of batch.cleanups) {
      const { target, impact } = cleanup;
      summary.runResults += impact.runResults;
      summary.estimatedReclaimableBytes += impact.estimatedReclaimableBytes;
      if (impact.runResults > 0) {
        this.logger.info(
          {
            projectId: target.projectId,
            sourceId: target.sourceId,
            retentionDays: target.retentionDays,
            cutoff: target.cutoff,
            runResults: impact.runResults,
            estimatedReclaimableBytes: impact.estimatedReclaimableBytes,
          },
          'release_run_results_retention_cleanup_done',
        );
      }
    }

    return summary;
  }

  async getExperimentRunResult(
    projectId: string,
    experimentId: string,
    runResultId: string,
    actor: CurrentUserPayload,
  ): Promise<RunResultDetailDto> {
    await this.assertExperimentAccessible(projectId, experimentId, actor);
    const detail = await this.repo.getDetailById(experimentId, runResultId);
    if (!detail) {
      throw new NotFoundException(`Run result ${runResultId} not found`);
    }
    return detail;
  }

  private assertCleanupVersionFilter(filter: ReleaseRunResultCleanupFilterDto): void {
    if (!filter.releaseVersionIds || filter.releaseVersionIds.length === 0) {
      throw new BadRequestException('run_result_cleanup_release_version_required');
    }

    if (!filter.to) return;

    const to = Date.parse(filter.to);
    const from = filter.from ? Date.parse(filter.from) : Number.NEGATIVE_INFINITY;
    if (!Number.isFinite(to) || (Number.isFinite(from) && from >= to)) {
      throw new BadRequestException('run_result_cleanup_invalid_time_range');
    }
  }

  private async *streamExperimentRunResultExport(
    experimentId: string,
    format: RunResultExportFormatDto,
    query: RunResultListQueryDto,
  ): AsyncGenerator<string> {
    if (format === 'csv') {
      yield csvLine(EXPERIMENT_RUN_RESULT_EXPORT_COLUMNS.map((column) => column.header));
    }

    let cursor: RunResultExportCursor | null = null;
    do {
      const batch = await this.repo.listExperimentExportBatch(experimentId, query, {
        limit: RUN_RESULT_EXPORT_BATCH_SIZE,
        cursor,
      });

      for (const row of batch.rows) {
        if (format === 'jsonl') {
          yield `${JSON.stringify(experimentRunResultExportRecord(row))}\n`;
          continue;
        }
        yield csvLine(EXPERIMENT_RUN_RESULT_EXPORT_COLUMNS.map((column) => column.value(row)));
      }

      cursor = batch.nextCursor;
    } while (cursor);
  }

  private async *streamReleaseRunResultExport(
    projectId: string,
    format: RunResultExportFormatDto,
    query: RunResultReleaseListQueryDto,
  ): AsyncGenerator<string> {
    if (format === 'csv') {
      yield csvLine(RELEASE_RUN_RESULT_EXPORT_COLUMNS.map((column) => column.header));
    }

    let cursor: RunResultExportCursor | null = null;
    do {
      const batch = await this.repo.listReleaseExportBatch(projectId, query, {
        limit: RUN_RESULT_EXPORT_BATCH_SIZE,
        cursor,
      });

      for (const row of batch.rows) {
        if (format === 'jsonl') {
          yield `${JSON.stringify(releaseRunResultExportRecord(row))}\n`;
          continue;
        }
        yield csvLine(RELEASE_RUN_RESULT_EXPORT_COLUMNS.map((column) => column.value(row)));
      }

      cursor = batch.nextCursor;
    } while (cursor);
  }

  private async assertExperimentAccessible(
    projectId: string,
    experimentId: string,
    actor: CurrentUserPayload,
  ): Promise<void> {
    await this.accessControl.assertCan(toActorContext(actor), { projectId, source: 'local' }, 'project_read');
    const access = await this.repo.findAccessibleExperiment(projectId, experimentId, actor.sub, actor.isSuperAdmin);
    if (!access) {
      throw new NotFoundException(`Experiment ${experimentId} not found`);
    }
  }
}

interface ExportColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

const EXPERIMENT_RUN_RESULT_EXPORT_COLUMNS: Array<ExportColumn<RunResultDetailDto>> = [
  { header: 'id', value: (row) => row.id },
  { header: 'project_id', value: (row) => row.projectId },
  { header: 'experiment_id', value: (row) => row.experimentId },
  { header: 'sample_id', value: (row) => row.sampleId },
  { header: 'external_id', value: (row) => row.externalId },
  { header: 'status', value: (row) => row.status },
  { header: 'judgment_status', value: (row) => row.judgmentStatus },
  { header: 'is_correct', value: (row) => row.isCorrect },
  { header: 'decision_output', value: (row) => row.decisionOutput },
  { header: 'expected_output', value: (row) => row.expectedOutput },
  { header: 'input_preview', value: (row) => row.inputPreview },
  { header: 'output_preview', value: (row) => row.outputPreview },
  { header: 'rendered_prompt', value: (row) => row.renderedPrompt },
  { header: 'input_variables', value: (row) => row.inputVariables },
  { header: 'raw_response', value: (row) => row.rawResponse },
  { header: 'parsed_output', value: (row) => row.parsedOutput },
  { header: 'error_class', value: (row) => row.errorClass },
  { header: 'error_message', value: (row) => row.errorMessage },
  { header: 'latency_ms', value: (row) => row.latencyMs },
  { header: 'input_tokens', value: (row) => row.inputTokens },
  { header: 'output_tokens', value: (row) => row.outputTokens },
  { header: 'cost_estimate', value: (row) => row.costEstimate },
  { header: 'attempt', value: (row) => row.attempt },
  { header: 'created_at', value: (row) => row.createdAt },
];

const RELEASE_RUN_RESULT_EXPORT_COLUMNS: Array<ExportColumn<ReleaseRunResultExportItem>> = [
  { header: 'id', value: (row) => row.id },
  { header: 'project_id', value: (row) => row.projectId },
  { header: 'source', value: (row) => row.source },
  { header: 'source_id', value: (row) => row.sourceId },
  { header: 'event_id', value: (row) => row.eventId },
  { header: 'lane', value: (row) => row.lane },
  { header: 'release_version_id', value: (row) => row.releaseVersionId },
  { header: 'release_version_label', value: (row) => row.releaseVersionLabel },
  { header: 'release_version_kind', value: (row) => row.releaseVersionKind },
  { header: 'external_id', value: (row) => row.externalId },
  { header: 'prompt_name', value: (row) => row.promptName },
  { header: 'prompt_version_id', value: (row) => row.promptVersionId },
  { header: 'prompt_version_number', value: (row) => row.promptVersionNumber },
  { header: 'model_id', value: (row) => row.modelId },
  { header: 'model_name', value: (row) => row.modelName },
  { header: 'model_provider', value: (row) => row.modelProvider },
  { header: 'status', value: (row) => row.status },
  { header: 'judgment_status', value: (row) => row.judgmentStatus },
  { header: 'is_correct', value: (row) => row.isCorrect },
  { header: 'decision_output', value: (row) => row.decisionOutput },
  { header: 'rendered_prompt', value: (row) => row.renderedPrompt },
  { header: 'input_variables', value: (row) => row.inputVariables },
  { header: 'raw_response', value: (row) => row.rawResponse },
  { header: 'parsed_output', value: (row) => row.parsedOutput },
  { header: 'error_class', value: (row) => row.errorClass },
  { header: 'error_message', value: (row) => row.errorMessage },
  { header: 'latency_ms', value: (row) => row.latencyMs },
  { header: 'input_tokens', value: (row) => row.inputTokens },
  { header: 'output_tokens', value: (row) => row.outputTokens },
  { header: 'cost_estimate', value: (row) => row.costEstimate },
  { header: 'attempt', value: (row) => row.attempt },
  { header: 'created_at', value: (row) => row.createdAt },
];

function experimentRunResultExportRecord(row: RunResultDetailDto): Record<string, unknown> {
  return Object.fromEntries(EXPERIMENT_RUN_RESULT_EXPORT_COLUMNS.map((column) => [column.header, column.value(row)]));
}

function releaseRunResultExportRecord(row: ReleaseRunResultExportItem): Record<string, unknown> {
  return Object.fromEntries(RELEASE_RUN_RESULT_EXPORT_COLUMNS.map((column) => [column.header, column.value(row)]));
}

function contentTypeForRunResultExport(format: RunResultExportFormatDto): string {
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8';
}

function csvLine(values: unknown[]): string {
  return `${values.map(csvCell).join(',')}\n`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
