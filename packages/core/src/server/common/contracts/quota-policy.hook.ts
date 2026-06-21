// QuotaPolicyHook — adapter extension point
// See docs/specs/08-saas-adapter-boundary.md §3.11
//
// OSS has no hosted plan envelope, so the local implementation is a no-op.
// Hosted deployments can override this hook to enforce resource quotas at the
// actual write / execution points without embedding billing semantics in OSS.

import type { ActorContext, ProjectContext } from '../actor-context';

export type StorageQuotaSource =
  | 'dataset_upload'
  | 'dataset_import'
  | 'dataset_import_batch'
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
}

export class LocalQuotaPolicyHook extends QuotaPolicyHook {
  async assertCanStore(_input: StorageQuotaInput): Promise<void> {
    // Local OSS has no hosted quota envelope.
  }

  async withExecutionSlot<T>(_input: ExecutionSlotInput, run: () => Promise<T>): Promise<T> {
    return run();
  }
}
