import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { LimiterKeyStrategy, LocalLimiterKeyStrategy } from '../limiter-key.strategy';
import { LocalContractsModule } from '../local-contracts.module';
import { LocalWorkflowAuthorizationHook, WorkflowAuthorizationHook } from '../workflow-authorization.hook';

// Asserts the contracts module binds + exports the new extension-point tokens to their Local* defaults
// without booting the Nest DI container (which would require a live DatabaseModule).
function providerFor(token: unknown): { provide: unknown; useClass?: unknown } | undefined {
  const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LocalContractsModule) ?? []) as Array<{
    provide?: unknown;
    useClass?: unknown;
  }>;
  return providers.find((p) => p && typeof p === 'object' && p.provide === token) as
    | { provide: unknown; useClass?: unknown }
    | undefined;
}

describe('LocalContractsModule new bindings', () => {
  it('binds LimiterKeyStrategy -> LocalLimiterKeyStrategy', () => {
    expect(providerFor(LimiterKeyStrategy)?.useClass).toBe(LocalLimiterKeyStrategy);
  });

  it('binds WorkflowAuthorizationHook -> LocalWorkflowAuthorizationHook', () => {
    expect(providerFor(WorkflowAuthorizationHook)?.useClass).toBe(LocalWorkflowAuthorizationHook);
  });

  it('exports both new tokens', () => {
    const exports = (Reflect.getMetadata(MODULE_METADATA.EXPORTS, LocalContractsModule) ?? []) as unknown[];
    expect(exports).toContain(LimiterKeyStrategy);
    expect(exports).toContain(WorkflowAuthorizationHook);
  });
});
