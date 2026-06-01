import { randomBytes } from 'node:crypto';
import { InvalidApiKeyPayloadError, encryptApiKey } from '@proofhound/crypto';
import { describe, expect, it } from 'vitest';
import { createModelSecretResolver } from '../model-secret';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

describe('createModelSecretResolver', () => {
  // Regression coverage: ciphertext written by server CryptoService.encryptApiKey() must be decryptable by the worker
  it('decrypts ciphertext produced by @proofhound/crypto.encryptApiKey', async () => {
    const plain = 'sk-prod-abc123';
    const apiKeyEncrypted = encryptApiKey(plain, ENCRYPTION_KEY);

    const resolver = createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY });

    await expect(resolver.resolveApiKey({ apiKeyEncrypted })).resolves.toBe(plain);
  });

  it('rejects garbage payloads (no silent fallback to plain text)', async () => {
    const resolver = createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY });

    await expect(resolver.resolveApiKey({ apiKeyEncrypted: 'not-real-ciphertext' })).rejects.toBeInstanceOf(
      InvalidApiKeyPayloadError,
    );
  });

  it('rejects ciphertext encrypted with a different key', async () => {
    const otherKey = randomBytes(32).toString('base64');
    const apiKeyEncrypted = encryptApiKey('sk-real', otherKey);

    const resolver = createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY });

    await expect(resolver.resolveApiKey({ apiKeyEncrypted })).rejects.toBeInstanceOf(
      InvalidApiKeyPayloadError,
    );
  });
});
