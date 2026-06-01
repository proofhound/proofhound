import { decryptApiKey } from '@proofhound/crypto';

export interface ModelSecretRow {
  apiKeyEncrypted: string;
}

export interface ModelSecretResolver {
  resolveApiKey(model: ModelSecretRow): Promise<string>;
}

export interface ModelSecretResolverOptions {
  encryptionKey: string;
}

// Decryption goes uniformly through @proofhound/crypto — sharing the same implementation + the same MODEL_API_KEY_ENCRYPTION_KEY with server CryptoService / seed-dev.
// The three legacy prefixes plain: / env: / aes-256-gcm: are no longer supported; the DB only stores the unprefixed base64 output of server CryptoService.encryptApiKey().
export function createModelSecretResolver(options: ModelSecretResolverOptions): ModelSecretResolver {
  return {
    async resolveApiKey(model) {
      return decryptApiKey(model.apiKeyEncrypted, options.encryptionKey);
    },
  };
}
