import type { DynamicModule, Type } from '@nestjs/common';

export interface ProofHoundRuntimeModuleOptions {
  // A @Global module binding every adapter extension-point token to an implementation.
  // OSS: LocalContractsModule. SaaS: SaasContractsModule.
  contracts: Type<unknown> | DynamicModule;
}
