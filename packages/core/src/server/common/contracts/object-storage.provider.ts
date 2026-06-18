// ObjectStorageProvider — adapter extension point: the large-payload / artifact storage layer.
// See docs/specs/08-saas-adapter-boundary.md (§2 assembly-time DI).
//
// The OSS default (LocalFsObjectStorageProvider) is disk-backed and reports isEnabled() === false
// when unconfigured, so an OSS deployment without object storage keeps its existing DB-only behaviour
// (callers must treat a disabled provider as "object storage unavailable" and stream / inline instead).
// Hosted deployments override this token with an S3 / R2 implementation.
//
// M1 scope: server-side direct writes + signed download only. Client-direct-upload
// (createUploadSession / completeUpload / abortUpload / sweepPendingUploads) lands in a later milestone.

import type { Readable } from 'node:stream';
import type { ProjectContext } from '../actor-context';

export type ObjectResourceType = 'dataset_raw' | 'dataset_normalized' | 'run_result_shard' | 'export';

/** Internal shard compression. Applied/removed at the application layer; NEVER mapped to HTTP
 * Content-Encoding (that would let SDKs/browsers auto-decompress, so stored bytes !== read bytes). */
export type ObjectCodec = 'gzip' | 'br' | 'zstd' | 'identity';

/**
 * Logical description of what is being stored. The provider — not the caller — turns this into a
 * physical key. OSS LocalFs ignores the tenant dimension; a hosted provider composes an org-scoped
 * prefix (orgs/{orgId}/projects/{projectId}/…) and writes its own object registry / audit row.
 */
export interface ResourceLocator {
  /** Tenant/project ownership. A hosted provider derives org-scoped prefixes + audit from it. */
  project: ProjectContext;
  resourceType: ObjectResourceType;
  resourceId: string;
  /** File name within the resource, e.g. part-00003.jsonl.gz / input.csv. */
  name: string;
}

/**
 * Self-describing reference to a stored object. This is the shape callers persist (e.g. into
 * run_results.payload_ref / dataset_samples.payload_ref); it MUST resolve back to the object
 * without depending on any hosted-only side-table id.
 */
export interface StoredObjectRef {
  provider: string; // 'localfs' | 'r2' | …
  bucket?: string;
  key: string;
  bytes: number; // real stored bytes (= compressed-on-disk size)
  codec?: ObjectCodec;
  // Download-only HTTP headers (export artifacts); do not affect shard read semantics.
  contentType?: string;
  contentDisposition?: string;
  // Integrity: ETag is not a content hash (multipart / S3-compatible), kept separate from sha256.
  etag?: string;
  sha256?: string;
  checksumAlgorithm?: 'sha256';
  resourceType: ObjectResourceType;
  resourceId: string;
  /** Generation of a logical shard; see the compaction protocol in the design doc. */
  version?: number;
  /** Hosted-only convenience (e.g. phs_storage_objects PK); never required to resolve the object. */
  storageObjectId?: string;
}

export interface GetObjectRange {
  /** Inclusive start byte offset. */
  start: number;
  /** Inclusive end byte offset; omit to read to EOF. */
  end?: number;
}

export interface PutObjectOptions {
  codec?: ObjectCodec;
  contentType?: string;
  contentDisposition?: string;
  /** Caller-supplied content hash; the provider stores it for integrity / cache validation. */
  sha256?: string;
}

export interface SignedDownloadUrl {
  url: string;
  expiresAt: string;
}

export abstract class ObjectStorageProvider {
  /**
   * False when no storage backend is configured. Callers MUST treat false as "object storage
   * unavailable" and keep the DB-inline / streamed-response behaviour, so an unconfigured OSS
   * deployment behaves exactly as before.
   */
  abstract isEnabled(): boolean;

  abstract putObject(loc: ResourceLocator, body: Buffer | Readable, opts?: PutObjectOptions): Promise<StoredObjectRef>;
  abstract getObject(ref: StoredObjectRef, range?: GetObjectRange): Promise<Buffer>;
  abstract getObjectStream(ref: StoredObjectRef, range?: GetObjectRange): Promise<Readable>;
  abstract deleteObjects(refs: StoredObjectRef[]): Promise<void>;

  /**
   * Mint a time-limited public download URL, or null when the provider cannot expose one
   * (e.g. LocalFs) — callers then fall back to streaming the object through the app server.
   */
  abstract createSignedDownloadUrl(
    ref: StoredObjectRef,
    opts?: { expiresInSeconds?: number },
  ): Promise<SignedDownloadUrl | null>;
}
