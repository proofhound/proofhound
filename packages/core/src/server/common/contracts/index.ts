// Adapter extension point barrel — abstract class + default implementations + types
// See docs/specs/08-saas-adapter-boundary.md

export * from './types';
export * from './project-context.resolver';
export * from './actor-context.resolver';
export * from './mcp-auth.resolver';
export * from './access-control.service';
export * from './connector-context.resolver';
export * from './token.service';
export * from './limiter-key.strategy';
export * from './workflow-authorization.hook';
export * from './http-actor.guard';
export * from './local-project-context.resolver';
export * from './local-actor-context.resolver';
export * from './local-mcp-auth.resolver';
export * from './local-access-control.service';
export * from './local-user-token.verifier';
export { LocalTokenService } from '../../modules/token/token.service';
export { LocalContractsModule } from './local-contracts.module';
