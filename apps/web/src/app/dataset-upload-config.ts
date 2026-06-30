import { DATASET_UPLOAD_MAX_BYTES } from '@proofhound/shared';

export function resolveDatasetUploadMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DATASET_UPLOAD_MAX_BYTES?.trim();
  if (!raw) return DATASET_UPLOAD_MAX_BYTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DATASET_UPLOAD_MAX_BYTES;

  return Math.floor(parsed);
}
