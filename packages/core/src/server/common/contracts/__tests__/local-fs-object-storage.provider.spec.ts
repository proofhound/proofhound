import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalFsObjectStorageProvider } from '../local-fs-object-storage.provider';
import { ObjectStorageProvider, type ResourceLocator } from '../object-storage.provider';

const loc: ResourceLocator = {
  project: { projectId: 'p1', source: 'local' },
  resourceType: 'export',
  resourceId: 'exp-1',
  name: 'dataset.csv',
};

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

describe('LocalFsObjectStorageProvider', () => {
  describe('unconfigured (no root)', () => {
    const provider = new LocalFsObjectStorageProvider(undefined);

    it('is an ObjectStorageProvider and reports disabled', () => {
      expect(provider).toBeInstanceOf(ObjectStorageProvider);
      expect(provider.isEnabled()).toBe(false);
    });

    it('throws on writes when unconfigured (OSS keeps DB-only behaviour)', async () => {
      await expect(provider.putObject(loc, Buffer.from('x'))).rejects.toThrow(/not configured/);
    });
  });

  describe('configured (temp root)', () => {
    let root: string;
    let provider: LocalFsObjectStorageProvider;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'ph-objstore-'));
      provider = new LocalFsObjectStorageProvider(root);
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('reports enabled', () => {
      expect(provider.isEnabled()).toBe(true);
    });

    it('put then get round-trips bytes and returns a self-describing ref', async () => {
      const body = Buffer.from('hello,world\n1,2\n', 'utf8');
      const ref = await provider.putObject(loc, body, { contentType: 'text/csv' });

      expect(ref.provider).toBe('localfs');
      expect(ref.key).toBe('export/exp-1/dataset.csv');
      expect(ref.bytes).toBe(body.byteLength);
      expect(ref.resourceType).toBe('export');
      expect(ref.resourceId).toBe('exp-1');
      expect(ref.contentType).toBe('text/csv');
      expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);

      // Self-describing: a fresh ref carrying only key/resource fields resolves the object.
      const reloaded = await provider.getObject({
        provider: ref.provider,
        key: ref.key,
        bytes: ref.bytes,
        resourceType: ref.resourceType,
        resourceId: ref.resourceId,
      });
      expect(reloaded.equals(body)).toBe(true);
    });

    it('honours an inclusive byte range', async () => {
      const ref = await provider.putObject(loc, Buffer.from('0123456789', 'utf8'));
      const slice = await provider.getObject(ref, { start: 2, end: 5 });
      expect(slice.toString('utf8')).toBe('2345');
    });

    it('accepts a Readable body and streams it back', async () => {
      const ref = await provider.putObject(loc, Readable.from([Buffer.from('abc'), Buffer.from('def')]));
      expect(ref.bytes).toBe(6);
      expect(await streamToString(await provider.getObjectStream(ref))).toBe('abcdef');
    });

    it('deletes objects', async () => {
      const ref = await provider.putObject(loc, Buffer.from('gone'));
      await provider.deleteObjects([ref]);
      await expect(provider.getObject(ref)).rejects.toThrow();
      // delete is idempotent (force) — a second delete does not throw.
      await expect(provider.deleteObjects([ref])).resolves.toBeUndefined();
    });

    it('cannot mint a public download URL (caller falls back to streaming)', async () => {
      const ref = await provider.putObject(loc, Buffer.from('x'));
      await expect(provider.createSignedDownloadUrl(ref)).resolves.toBeNull();
    });

    it('rejects keys that escape the storage root', async () => {
      const escaping: ResourceLocator = { ...loc, resourceId: '..', name: '../escape' };
      await expect(provider.putObject(escaping, Buffer.from('x'))).rejects.toThrow(/escapes storage root/);
    });

    it('rejects a key that resolves to the storage root itself', async () => {
      // `export/.`+`..` resolves back to root; must be rejected so deleteObjects can't target root.
      const rootKey: ResourceLocator = { ...loc, resourceId: '.', name: '..' };
      await expect(provider.putObject(rootKey, Buffer.from('x'))).rejects.toThrow(/escapes storage root/);
      await expect(provider.deleteObjects([{ provider: 'localfs', key: '.', bytes: 0, resourceType: 'export', resourceId: '.' }])).rejects.toThrow(
        /escapes storage root/,
      );
    });
  });
});
