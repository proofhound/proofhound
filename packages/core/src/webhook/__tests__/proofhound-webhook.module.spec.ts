import { Global, Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ConnectorContextResolver } from '../../server/common/contracts/connector-context.resolver';
import { WorkflowAuthorizationHook } from '../../server/common/contracts/workflow-authorization.hook';
import { WebhookModule } from '../channels/webhook/webhook.module';
import { ProofHoundWebhookModule } from '../proofhound-webhook.module';

@Global()
@Module({})
class FakeContractsModule {}

describe('ProofHoundWebhookModule contract wiring', () => {
  it('imports the edition-supplied contracts module through forRoot', () => {
    const dynamicModule = ProofHoundWebhookModule.forRoot({ contracts: FakeContractsModule });

    expect(dynamicModule.imports).toContain(FakeContractsModule);
  });

  it('does not bind local contract defaults in the webhook feature module', () => {
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WebhookModule) ?? []) as unknown[];

    expect(providers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ provide: ConnectorContextResolver })]),
    );
    expect(providers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ provide: WorkflowAuthorizationHook })]),
    );
  });
});
