import { Global, Module } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { LimiterKeyStrategy } from '../../server/common/contracts/limiter-key.strategy';
import { RuntimeLimitsProvider } from '../../server/common/contracts/runtime-limits.provider';
import { ProofHoundWorkerModule } from '../proofhound-worker.module';

@Global()
@Module({})
class FakeContractsModule {}

describe('ProofHoundWorkerModule contract wiring', () => {
  it('imports the edition-supplied contracts module through forRoot', () => {
    const dynamicModule = ProofHoundWorkerModule.forRoot({ contracts: FakeContractsModule });

    expect(dynamicModule.imports).toContain(FakeContractsModule);
  });

  it('does not bind a local LimiterKeyStrategy provider that would shadow the contracts module', () => {
    const dynamicModule = ProofHoundWorkerModule.forRoot({ contracts: FakeContractsModule });

    expect(dynamicModule.providers ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ provide: LimiterKeyStrategy })]),
    );
  });

  it('does not bind a local RuntimeLimitsProvider provider that would shadow the contracts module', () => {
    const dynamicModule = ProofHoundWorkerModule.forRoot({ contracts: FakeContractsModule });

    expect(dynamicModule.providers ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ provide: RuntimeLimitsProvider })]),
    );
  });
});
