// ObjectStorageProvider — adapter extension point: the large-payload / artifact storage layer.
// See docs/specs/08-saas-adapter-boundary.md (§2 assembly-time DI).
//
// The OSS default (LocalFsObjectStorageProvider) is disk-backed and reports isEnabled() === false
// when unconfigured, so an OSS deployment without object storage keeps its existing DB-only behaviour
// (callers must treat a disabled provider as "object storage unavailable" and stream / inline instead).
// Hosted deployments override this token with an S3 / R2 implementation.
//
// Capabilities: server-side direct writes + signed download (putObject / getObject / …), and
// client-direct-upload via a pending→finalize protocol (createUploadSession / completeUpload /
// abortUpload / sweepPendingUploads). A provider that cannot mint browser-reachable URLs (LocalFs)
// returns null from the URL-minting methods so callers fall back to server-proxied transfer.

import type { Readable } from 'node:stream';
import type { ActorContext, ProjectContext } from '../actor-context';

export type ObjectResourceType = 'dataset_normalized' | 'dataset_raw' | 'run_result_shard' | 'export';

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

export interface CreateUploadSessionOptions {
  contentType?: string;
  /** Upper bound recorded with the pending session; finalize rejects an upload larger than this. */
  maxBytes?: number;
  /** Expected content hash; finalize verifies the uploaded object against it. */
  expectedSha256?: string;
  expiresInSeconds?: number;
}

export interface UploadSession {
  /** Opaque id the caller passes back to completeUpload / abortUpload. */
  sessionId: string;
  /** Pre-authorized URL the client PUTs the bytes to. */
  url: string;
  /** Headers the client must send with the PUT (e.g. Content-Type pinned by the signature). */
  headers?: Record<string, string>;
  expiresAt: string;
}

export interface CompleteUploadInput {
  sessionId: string;
  /** Caller context; the provider re-checks the pending object belongs to this tenant/project. */
  actor: ActorContext;
  project: ProjectContext;
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

  // —— Client-direct-upload: pending → finalize protocol. ——
  //
  // The presigned URL is a bearer token (reusable until expiry), so completeUpload re-verifies the
  // pending object's size/hash/ownership before finalizing. These ship as concrete methods with an
  // "unsupported" default (not abstract) so adding them is non-breaking: an existing subclass that
  // hasn't implemented them keeps compiling and inherits the default. A provider that can mint
  // browser-reachable upload URLs (e.g. R2) overrides them; LocalFs keeps the default.

  /** Whether this provider can mint browser-reachable upload sessions. Default: unsupported. */
  supportsClientUploadSessions(): boolean {
    return false;
  }

  /** Open a pending upload and return a URL the client PUTs to. Default: unsupported (null). */
  async createUploadSession(_loc: ResourceLocator, _opts?: CreateUploadSessionOptions): Promise<UploadSession | null> {
    return null;
  }
  /** Verify (HeadObject: size/sha256/contentType) + ownership, then finalize. Default: unsupported. */
  async completeUpload(_input: CompleteUploadInput): Promise<StoredObjectRef> {
    throw new Error('object storage provider does not support client-direct upload sessions');
  }
  /** Discard a pending upload (and its object, if any). Default: no-op. */
  async abortUpload(_sessionId: string): Promise<void> {
    // no pending sessions by default
  }
  /** Sweep pending uploads not finalized before `olderThan` (ISO); returns the count. Default: 0. */
  async sweepPendingUploads(_olderThan: string): Promise<number> {
    return 0;
  }
}
