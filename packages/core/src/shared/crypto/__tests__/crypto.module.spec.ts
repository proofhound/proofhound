import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ConfigModule } from '../../config/config.module';
import { CryptoModule } from '../crypto.module';

describe('CryptoModule', () => {
  it('imports ConfigModule for CryptoService dependencies', () => {
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, CryptoModule) ?? []) as unknown[];

    expect(imports).toContain(ConfigModule);
  });
});
