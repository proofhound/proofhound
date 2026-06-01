import { createModelSecretResolver, type ModelSecretResolver } from '../../runners/model-secret';

export const MODEL_SECRET_RESOLVER = Symbol('MODEL_SECRET_RESOLVER');

export function modelSecretResolverFactory(): ModelSecretResolver {
  const encryptionKey = process.env['MODEL_API_KEY_ENCRYPTION_KEY'];
  if (!encryptionKey) {
    throw new Error('MODEL_API_KEY_ENCRYPTION_KEY is required to decrypt model api keys');
  }
  return createModelSecretResolver({ encryptionKey });
}
