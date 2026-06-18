// LocalFsObjectStorageProvider — OSS default ObjectStorageProvider.
//
// Disk-backed for self-hosting; disabled (isEnabled() === false) when no root is configured, so the
// OSS mainline keeps its DB-only behaviour. It cannot mint browser-reachable signed URLs, so
// createSignedDownloadUrl() returns null and callers stream the object through the app server.
//
// Key convention (OSS): {resourceType}/{resourceId}/{name} — no tenant prefix; ownership lives in the
// database (see docs/specs/04-postgresql.md). A hosted provider composes its own org-scoped key.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import {
  type GetObjectRange,
  ObjectStorageProvider,
  type PutObjectOptions,
  type ResourceLocator,
  type SignedDownloadUrl,
  type StoredObjectRef,
} from './object-storage.provider';

const PROVIDER = 'localfs';

export class LocalFsObjectStorageProvider extends ObjectStorageProvider {
  private readonly root?: string;

  constructor(root: string | undefined = process.env.PH_OBJECT_STORAGE_LOCAL_ROOT) {
    super();
    this.root = root && root.trim() ? resolve(root) : undefined;
  }

  isEnabled(): boolean {
    return this.root !== undefined;
  }

  async putObject(loc: ResourceLocator, body: Buffer | Readable, opts?: PutObjectOptions): Promise<StoredObjectRef> {
    const root = this.requireRoot();
    const key = buildKey(loc);
    const abs = absForKey(root, key);
    await mkdir(dirname(abs), { recursive: true });
    const buf = Buffer.isBuffer(body) ? body : await streamToBuffer(body);
    await writeFile(abs, buf);
    return {
      provider: PROVIDER,
      key,
      bytes: buf.byteLength,
      codec: opts?.codec,
      contentType: opts?.contentType,
      contentDisposition: opts?.contentDisposition,
      sha256: opts?.sha256 ?? createHash('sha256').update(buf).digest('hex'),
      checksumAlgorithm: 'sha256',
      resourceType: loc.resourceType,
      resourceId: loc.resourceId,
    };
  }

  async getObject(ref: StoredObjectRef, range?: GetObjectRange): Promise<Buffer> {
    const buf = await readFile(absForKey(this.requireRoot(), ref.key));
    if (!range) return buf;
    const end = range.end === undefined ? buf.byteLength : range.end + 1;
    return buf.subarray(range.start, end);
  }

  async getObjectStream(ref: StoredObjectRef, range?: GetObjectRange): Promise<Readable> {
    const abs = absForKey(this.requireRoot(), ref.key);
    return createReadStream(abs, range ? { start: range.start, end: range.end } : undefined);
  }

  async deleteObjects(refs: StoredObjectRef[]): Promise<void> {
    const root = this.requireRoot();
    await Promise.all(refs.map((ref) => rm(absForKey(root, ref.key), { force: true })));
  }

  // LocalFs cannot expose a browser-reachable URL; caller streams via getObjectStream instead.
  async createSignedDownloadUrl(
    _ref: StoredObjectRef,
    _opts?: { expiresInSeconds?: number },
  ): Promise<SignedDownloadUrl | null> {
    return null;
  }

  private requireRoot(): string {
    if (this.root === undefined) {
      throw new Error('LocalFsObjectStorageProvider is not configured (set PH_OBJECT_STORAGE_LOCAL_ROOT).');
    }
    return this.root;
  }
}

function buildKey(loc: ResourceLocator): string {
  return [loc.resourceType, loc.resourceId, loc.name].join('/');
}

function absForKey(root: string, key: string): string {
  const abs = resolve(root, key);
  // Guard against keys escaping the storage root (path traversal).
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error('object key escapes storage root');
  }
  return abs;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
