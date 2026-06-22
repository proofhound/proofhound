import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { DatasetFieldMappingDto, DatasetImportSourceFormat } from '@proofhound/shared';
import type { DatasetRawImportJobPayload } from '@proofhound/orchestration-shared';
import { buildDatasetFieldSchema } from '../../server/modules/dataset/dataset-field-schema.util';
import { parseRawDatasetRows } from '../../server/modules/dataset/dataset-import-raw-parser';
import type { DatasetImportRepository } from '../../server/modules/dataset/dataset-import.repository';
import {
  DatasetImportAbortedError,
  DatasetImportEmptyError,
  DatasetNameTakenError,
  type BatchSampleRow,
  type DatasetImportRow,
} from '../../server/modules/dataset/dataset-import.repository';
import type { ObjectStorageProvider } from '../../server/common/contracts/object-storage.provider';
import { type StoredObjectRef } from '../../server/common/contracts/object-storage.provider';
import type { QuotaPolicyHook } from '../../server/common/contracts/quota-policy.hook';
import { safeRecordUsageEvent, type UsageMeteringHook } from '../../server/common/contracts/usage-metering.hook';
import type { ActorContext } from '../../server/common/actor-context';

const TYPE_INFERENCE_SAMPLE_LIMIT = 500;
const IMAGE_ROLES = new Set(['image', 'image_url', 'image_base64']);
const RAW_IMPORT_BATCH_MAX_ROWS = 1000;
const RAW_IMPORT_BATCH_MAX_BYTES = 8 * 1024 * 1024;
const RAW_IMPORT_MAX_SAMPLE_BYTES = 8 * 1024 * 1024;
const RAW_IMPORT_MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

export interface DatasetRawImportRunnerDependencies {
  repo: DatasetImportRepository;
  storage: ObjectStorageProvider;
  quotaPolicy: QuotaPolicyHook;
  usageMetering: UsageMeteringHook;
  logger: Logger;
}

export interface DatasetRawImportJobContext {
  bullmqJobId: string;
  bullmqQueue: string;
  attempt: number;
}

class DatasetImportPromotionInProgressError extends Error {
  constructor(readonly row: DatasetImportRow) {
    super('dataset_import_promotion_in_progress');
  }
}

export function createDatasetRawImportRunner(deps: DatasetRawImportRunnerDependencies) {
  return async function runDatasetRawImportJob(
    input: DatasetRawImportJobPayload,
    jobContext: DatasetRawImportJobContext,
  ): Promise<{ importId: string; datasetId: string | null; sampleCount: number; status: string }> {
    const session = await deps.repo.findImportById(input.projectId, input.importId);
    if (!session) return { importId: input.importId, datasetId: null, sampleCount: 0, status: 'missing' };
    if (session.status === 'completed' || session.status === 'failed' || session.status === 'aborted') {
      return {
        importId: session.id,
        datasetId: session.datasetId,
        sampleCount: session.receivedRows,
        status: session.status,
      };
    }
    if (isPromotionPhase(session)) {
      return {
        importId: session.id,
        datasetId: session.datasetId,
        sampleCount: session.receivedRows,
        status: session.status,
      };
    }

    if (session.importMode !== 'raw_object') {
      await deps.repo.markFailed(
        input.projectId,
        input.importId,
        'dataset_import_mode_invalid',
        'raw import job requires raw_object mode',
      );
      return { importId: input.importId, datasetId: null, sampleCount: 0, status: 'failed' };
    }
    if (!session.rawObjectRef) {
      await deps.repo.markFailed(
        input.projectId,
        input.importId,
        'dataset_raw_object_missing',
        'uploaded raw object is missing',
      );
      return { importId: input.importId, datasetId: null, sampleCount: 0, status: 'failed' };
    }

    try {
      const parsing = (await deps.repo.markParsing(input.projectId, input.importId)) ?? session;
      await ingestRawObjectIntoStaging(deps, input, parsing, session.rawObjectRef);
      const result = await promoteStagedImport(deps, input, parsing);
      await cleanupRawObjectRef(deps, session.rawObjectRef, input.importId);
      await recordJobEvent(deps, input, jobContext, 'job.completed', {
        status: 'completed',
        datasetId: result.datasetId,
        sampleCount: result.sampleCount,
      });
      deps.logger.info(
        { importId: input.importId, datasetId: result.datasetId, sampleCount: result.sampleCount },
        'dataset_raw_import_completed',
      );
      return {
        importId: input.importId,
        datasetId: result.datasetId,
        sampleCount: result.sampleCount,
        status: 'completed',
      };
    } catch (error) {
      if (error instanceof DatasetImportPromotionInProgressError) {
        return {
          importId: input.importId,
          datasetId: error.row.datasetId,
          sampleCount: error.row.receivedRows,
          status: error.row.status,
        };
      }
      const latest = await deps.repo.findImportById(input.projectId, input.importId);
      if (latest?.status === 'aborted' || error instanceof DatasetImportAbortedError) {
        await deps.repo.clearStaging(input.importId);
        await cleanupRawObjectRef(deps, session.rawObjectRef, input.importId);
        return { importId: input.importId, datasetId: null, sampleCount: latest?.receivedRows ?? 0, status: 'aborted' };
      }

      const errorCode = errorToCode(error);
      await deps.repo.markFailed(
        input.projectId,
        input.importId,
        errorCode,
        error instanceof Error ? error.message : String(error),
      );
      await cleanupRawObjectRef(deps, session.rawObjectRef, input.importId);
      await recordJobEvent(deps, input, jobContext, 'job.failed', {
        status: 'failed',
        errorKind: errorCode,
      });
      deps.logger.warn(
        { importId: input.importId, error: error instanceof Error ? error.message : String(error) },
        'dataset_raw_import_failed',
      );
      return { importId: input.importId, datasetId: null, sampleCount: 0, status: 'failed' };
    }
  };
}

async function ingestRawObjectIntoStaging(
  deps: DatasetRawImportRunnerDependencies,
  input: DatasetRawImportJobPayload,
  session: DatasetImportRow,
  rawObjectRef: StoredObjectRef,
): Promise<void> {
  const stream = await deps.storage.getObjectStream(rawObjectRef);
  const fieldMappings = toFieldMappings(session);
  const externalIdField = externalIdFieldName(fieldMappings);
  const project = { projectId: input.projectId, source: 'local' as const };
  const actor = toJobActor(input);
  let batch: BatchSampleRow[] = [];
  let batchBytes = jsonArrayBytesForEmptyBatch();
  let rowIndex = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await deps.quotaPolicy.assertCanStore({
      actor,
      bytes: batchBytes,
      project,
      source: 'dataset_raw_import_batch',
    });
    await deps.repo.appendBatch(session.id, batch, rowIndex);
    await assertNotAborted(deps.repo, input.projectId, input.importId);
    batch = [];
    batchBytes = jsonArrayBytesForEmptyBatch();
  };

  for await (const rawRow of parseRawDatasetRows(stream, session.sourceFormat as DatasetImportSourceFormat, {
    maxBufferedBytes: RAW_IMPORT_MAX_BUFFERED_BYTES,
  })) {
    if (batch.length >= RAW_IMPORT_BATCH_MAX_ROWS) await flush();

    const data = projectSample(rawRow, fieldMappings);
    const sampleBytes = utf8JsonBytes(data);
    if (sampleBytes > RAW_IMPORT_MAX_SAMPLE_BYTES) throw new Error('dataset_import_sample_too_large');

    let candidateBytes = jsonArrayBytesAfterAppend(batchBytes, batch.length, sampleBytes);
    if (candidateBytes > RAW_IMPORT_BATCH_MAX_BYTES) {
      if (batch.length === 0) throw new Error('dataset_import_sample_too_large');
      await flush();
      candidateBytes = jsonArrayBytesAfterAppend(batchBytes, batch.length, sampleBytes);
      if (candidateBytes > RAW_IMPORT_BATCH_MAX_BYTES) throw new Error('dataset_import_sample_too_large');
    }

    batch.push({ rowIndex, data, externalId: getExternalId(data, externalIdField) });
    batchBytes = candidateBytes;
    rowIndex += 1;
  }

  await flush();
}

async function promoteStagedImport(
  deps: DatasetRawImportRunnerDependencies,
  input: DatasetRawImportJobPayload,
  session: DatasetImportRow,
): Promise<{ datasetId: string; sampleCount: number }> {
  const promoting = await deps.repo.markPromoting(input.projectId, session.id);
  if (!promoting) {
    const latest = await deps.repo.findImportById(input.projectId, session.id);
    if (latest?.status === 'aborted') throw new DatasetImportAbortedError();
    if (latest && isPromotionPhase(latest)) throw new DatasetImportPromotionInProgressError(latest);
    throw new Error('dataset_import_not_promotable');
  }
  const sampleRows = await deps.repo.getSampleDataForInference(promoting.id, TYPE_INFERENCE_SAMPLE_LIMIT);
  const fieldSchema = buildDatasetFieldSchema(toFieldMappings(promoting), sampleRows);
  const hasImages = fieldSchema.some((field) => IMAGE_ROLES.has(field.role));
  const datasetId = randomUUID();
  const { sampleCount } = await deps.repo.promote({
    importId: promoting.id,
    projectId: input.projectId,
    actorUserId: input.actorId ?? promoting.createdBy,
    datasetId,
    name: promoting.name,
    description: promoting.description,
    fieldSchema,
    hasImages,
    onProgress: (progress) => deps.repo.updateProgress(input.projectId, promoting.id, progress),
  });
  await recordDatasetImportCompleted(
    deps,
    input.projectId,
    input.actorId ?? promoting.createdBy,
    promoting.id,
    datasetId,
    sampleCount,
  );
  return { datasetId, sampleCount };
}

async function assertNotAborted(repo: DatasetImportRepository, projectId: string, importId: string): Promise<void> {
  const latest = await repo.findImportById(projectId, importId);
  if (latest?.status === 'aborted') throw new DatasetImportAbortedError();
}

function toFieldMappings(session: DatasetImportRow): DatasetFieldMappingDto[] {
  return Array.isArray(session.fieldMappings) ? (session.fieldMappings as DatasetFieldMappingDto[]) : [];
}

function isPromotionPhase(session: DatasetImportRow): boolean {
  if (session.progress === null || typeof session.progress !== 'object' || Array.isArray(session.progress)) return false;
  const phase = (session.progress as Record<string, unknown>)['phase'];
  return phase === 'finalizing' || phase === 'offloading' || phase === 'committing';
}

function externalIdFieldName(fieldMappings: DatasetFieldMappingDto[]): string | null {
  return fieldMappings.find((field) => field.role === 'id')?.name ?? null;
}

function getExternalId(sample: Record<string, unknown>, fieldName: string | null): string | null {
  if (!fieldName) return null;
  const value = sample[fieldName];
  if (value === undefined || value === null) return null;
  return String(value);
}

function projectSample(
  sample: Record<string, unknown>,
  fieldMappings: DatasetFieldMappingDto[],
): Record<string, unknown> {
  return Object.fromEntries(
    fieldMappings.map((field) => [
      field.name,
      Object.prototype.hasOwnProperty.call(sample, field.name) ? sample[field.name] : null,
    ]),
  );
}

async function cleanupRawObjectRef(
  deps: DatasetRawImportRunnerDependencies,
  ref: StoredObjectRef,
  importId: string,
): Promise<void> {
  await deps.storage.deleteObjects([ref]).catch((error) => {
    deps.logger.warn({ importId, key: ref.key, error: (error as Error).message }, 'dataset_raw_object_delete_failed');
  });
}

async function recordDatasetImportCompleted(
  deps: DatasetRawImportRunnerDependencies,
  projectId: string,
  actorId: string,
  importId: string,
  datasetId: string,
  sampleCount: number,
): Promise<void> {
  const occurredAt = new Date();
  for (const eventType of ['dataset_import.completed', 'storage.dirty'] as const) {
    await safeRecordUsageEvent(
      deps.usageMetering,
      {
        idempotencyKey: `storage:${eventType}:${datasetId}:${importId}`,
        dimension: 'storage',
        eventType,
        projectId,
        actorId,
        occurredAt,
        source: 'worker',
        payload: {
          importId,
          datasetId,
          sampleCount,
          reason: eventType === 'storage.dirty' ? 'dataset_import.completed' : undefined,
        },
      },
      deps.logger,
    );
  }
}

async function recordJobEvent(
  deps: DatasetRawImportRunnerDependencies,
  input: DatasetRawImportJobPayload,
  jobContext: DatasetRawImportJobContext,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await safeRecordUsageEvent(
    deps.usageMetering,
    {
      idempotencyKey: `job:${jobContext.bullmqQueue}:${jobContext.bullmqJobId}:${jobContext.attempt}:${eventType}`,
      dimension: 'job',
      eventType,
      projectId: input.projectId,
      actorId: input.actorId ?? null,
      occurredAt: new Date(),
      source: 'worker',
      payload: {
        queue: jobContext.bullmqQueue,
        jobId: jobContext.bullmqJobId,
        attempt: jobContext.attempt,
        importId: input.importId,
        source: 'dataset_import',
        ...payload,
      },
    },
    deps.logger,
  );
}

function toJobActor(input: DatasetRawImportJobPayload): ActorContext {
  return {
    actorKind: 'local_user',
    actorId: input.actorId ?? 'dataset_import_worker',
    projectId: input.projectId,
  };
}

function errorToCode(error: unknown): string {
  if (error instanceof DatasetImportEmptyError) return 'dataset_import_empty';
  if (error instanceof DatasetNameTakenError) return 'dataset_name_taken';
  if (error instanceof Error && error.message) return error.message.slice(0, 120).replace(/[^a-z0-9_.:-]+/giu, '_');
  return 'dataset_import_failed';
}

function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function jsonArrayBytesForEmptyBatch(): number {
  return 2; // []
}

function jsonArrayBytesAfterAppend(currentArrayBytes: number, currentLength: number, nextItemBytes: number): number {
  return currentLength === 0 ? jsonArrayBytesForEmptyBatch() + nextItemBytes : currentArrayBytes + 1 + nextItemBytes;
}
