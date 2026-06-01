import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../../../shared/database/database.module';
import { AnnotationModule } from '../annotation.module';

describe('AnnotationModule', () => {
  it('imports DatabaseModule for annotation repository database dependencies', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AnnotationModule) ?? [];

    expect(imports).toContain(DatabaseModule);
  });
});
