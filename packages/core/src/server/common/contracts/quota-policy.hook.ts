// QuotaPolicyHook — adapter extension point
// See docs/specs/08-adapter-extension-points.md §3.11
//
// OSS has no hosted plan envelope, so the local implementation is a no-op.
// Hosted deployments can override this hook to enforce resource quotas at the
// actual write / execution points without embedding billing semantics in OSS.
//
// `resolveStorageQuotaBytes` returns the per-write byte ceiling for a source so callers that must know
// the limit BEFORE consuming the body (the multipart upload interceptor) and after (the service guard)
// share one number with `assertCanStore`. The OSS default returns the static dataset-upload cap; a
// hosted override resolves it from the request's plan.

import { DATASET_UPLOAD_MAX_BYTES } from '@proofhound/shared';
import type { ActorContext, ProjectContext } from '../actor-context';

export type StorageQuotaSource =
  | 'dataset_upload'
  | 'dataset_import'
  | 'dataset_import_batch'
  | 'dataset_raw_import'
  | 'dataset_raw_import_batch'
  | 'dataset_import_complete'
  | 'run_result';

export interface StorageQuotaInput {
  project: ProjectContext;
  source: StorageQuotaSource;
  actor?: ActorContext;
  /** Best-effort expected bytes for the incoming write. */
  bytes?: number;
}

export interface ExecutionSlotInput {
  project: ProjectContext;
  source: string;
  modelId?: string;
  requestId?: string;
}

export abstract class QuotaPolicyHook {
  abstract assertCanStore(input: StorageQuotaInput): Promise<void>;
  abstract withExecutionSlot<T>(input: ExecutionSlotInput, run: () => Promise<T>): Promise<T>;
  /**
   * Per-write byte ceiling for `input.source`, or `null` when the source is not size-capped.
   * Resolved per request so size enforcement can be plan-aware without a static cap.
   */
  abstract resolveStorageQuotaBytes(input: StorageQuotaInput): Promise<number | null>;
}

export class LocalQuotaPolicyHook extends QuotaPolicyHook {
  async assertCanStore(_input: StorageQuotaInput): Promise<void> {
    // Local OSS has no hosted quota envelope.
  }

  async withExecutionSlot<T>(_input: ExecutionSlotInput, run: () => Promise<T>): Promise<T> {
    return run();
  }

  async resolveStorageQuotaBytes(input: StorageQuotaInput): Promise<number | null> {
    // OSS has no plan envelope: only the dataset upload path is size-capped, at the static default
    // (overridable by the DATASET_UPLOAD_MAX_BYTES env for self-hosters). Other sources are uncapped.
    if (input.source !== 'dataset_upload') return null;
    const raw = Number(process.env['DATASET_UPLOAD_MAX_BYTES']);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DATASET_UPLOAD_MAX_BYTES;
  }
}
