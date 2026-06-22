import type { StoredObjectRef } from '../../common/contracts/object-storage.provider';

export function collectStoredObjectRefs(values: unknown[]): StoredObjectRef[] {
  const refs = new Map<string, StoredObjectRef>();
  for (const value of values) {
    const ref = toStoredObjectRef(value);
    if (!ref) continue;
    refs.set(storedObjectRefIdentity(ref), ref);
  }
  return [...refs.values()];
}

export function sumStoredObjectBytes(refs: readonly StoredObjectRef[]): number {
  return refs.reduce((sum, ref) => sum + Math.max(0, nonnegativeInteger(ref.bytes)), 0);
}

export function storedObjectRefIdentity(ref: StoredObjectRef): string {
  return `${ref.provider}:${ref.bucket ?? ''}:${ref.key}`;
}

function toStoredObjectRef(value: unknown): StoredObjectRef | null {
  if (isStoredObjectRef(value)) return value;
  if (isRecord(value) && isStoredObjectRef(value['shard'])) return value['shard'];
  return null;
}

function isStoredObjectRef(value: unknown): value is StoredObjectRef {
  if (!isRecord(value)) return false;
  return (
    typeof value['provider'] === 'string' &&
    typeof value['key'] === 'string' &&
    typeof value['bytes'] === 'number' &&
    typeof value['resourceType'] === 'string' &&
    typeof value['resourceId'] === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
