import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

export interface McpToolContext {
  actorUserId: string;
  actor?: CurrentUserPayload;
  email?: string;
  isSuperAdmin?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
  handler: (input: Record<string, unknown>, context: McpToolContext) => Promise<unknown>;
}
