// DI token for the assembled MCP tool list (McpToolDefinition[]).
// Provided by a factory in McpModule that injects every domain Service and concatenates the
// `createXxxTools(service)` aggregators from ./index.

export const MCP_TOOLS = Symbol('MCP_TOOLS');
