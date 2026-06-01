import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptApiKey, encryptApiKey } from '@proofhound/crypto';

// The API KEY encryption/decryption algorithm and format are defined in @proofhound/crypto — the single source of truth for server / worker / seed.
// This service only injects MODEL_API_KEY_ENCRYPTION_KEY and exposes a NestJS-friendly wrapper.

@Injectable()
export class CryptoService {
  private readonly keyBase64: string;

  constructor(configService: ConfigService) {
    this.keyBase64 = configService.getOrThrow<string>('MODEL_API_KEY_ENCRYPTION_KEY');
  }

  encryptApiKey(plain: string): string {
    return encryptApiKey(plain, this.keyBase64);
  }

  decryptApiKey(payload: string): string {
    return decryptApiKey(payload, this.keyBase64);
  }

  getCredentialTail(plain: string): string {
    return plain.length <= 4 ? plain : plain.slice(-4);
  }
}
