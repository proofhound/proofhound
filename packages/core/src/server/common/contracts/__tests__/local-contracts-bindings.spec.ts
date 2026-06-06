import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { LocalConnectorContextResolver } from '../../../../webhook/channels/webhook/local-connector-context.resolver';
import { ConnectorContextResolver } from '../connector-context.resolver';
import { LimiterKeyStrategy, LocalLimiterKeyStrategy } from '../limiter-key.strategy';
import { LocalContractsModule } from '../local-contracts.module';
import { LocalRuntimeLimitsProvider, RuntimeLimitsProvider } from '../runtime-limits.provider';
import { LocalTokenService } from '../../../modules/token/token.service';
import { TokenService } from '../token.service';
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
  it('binds TokenService -> LocalTokenService', () => {
    expect(providerFor(TokenService)?.useClass).toBe(LocalTokenService);
  });

  it('binds LimiterKeyStrategy -> LocalLimiterKeyStrategy', () => {
    expect(providerFor(LimiterKeyStrategy)?.useClass).toBe(LocalLimiterKeyStrategy);
  });

  it('binds WorkflowAuthorizationHook -> LocalWorkflowAuthorizationHook', () => {
    expect(providerFor(WorkflowAuthorizationHook)?.useClass).toBe(LocalWorkflowAuthorizationHook);
  });

  it('binds RuntimeLimitsProvider -> LocalRuntimeLimitsProvider', () => {
    expect(providerFor(RuntimeLimitsProvider)?.useClass).toBe(LocalRuntimeLimitsProvider);
  });

  it('binds ConnectorContextResolver -> LocalConnectorContextResolver', () => {
    expect(providerFor(ConnectorContextResolver)?.useClass).toBe(LocalConnectorContextResolver);
  });

  it('exports extension-point tokens', () => {
    const exports = (Reflect.getMetadata(MODULE_METADATA.EXPORTS, LocalContractsModule) ?? []) as unknown[];
    expect(exports).toContain(ConnectorContextResolver);
    expect(exports).toContain(TokenService);
    expect(exports).toContain(LimiterKeyStrategy);
    expect(exports).toContain(RuntimeLimitsProvider);
    expect(exports).toContain(WorkflowAuthorizationHook);
  });
});
