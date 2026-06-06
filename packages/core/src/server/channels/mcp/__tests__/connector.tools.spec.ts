import { describe, expect, it, vi } from 'vitest';
import type { ConnectorService } from '../../../modules/connector/connector.service';
import { createConnectorTools } from '../connector.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = 'org-mcp-connector';
const CONNECTOR_ID = '22222222-2222-4222-8222-222222222222';

const actor = {
  sub: 'mcp-user-token-1',
  actorId: 'mcp-user-token-1',
  actorKind: 'system_mcp' as const,
  projectId: PROJECT_ID,
  email: '',
  isSuperAdmin: false,
  isActive: true,
};

const context: McpToolContext = {
  actorUserId: actor.actorId,
  actor,
  project: { projectId: PROJECT_ID, orgId: ORG_ID, source: 'local' },
};

describe('MCP connector tools', () => {
  it('passes resolved project orgId into connector_probe workflow start', async () => {
    const service = {
      probe: vi.fn().mockResolvedValue({ connectorId: CONNECTOR_ID, status: 'success' }),
    } as unknown as ConnectorService;
    const probeTool = createConnectorTools(service).find((tool) => tool.name === 'connector_probe');
    if (!probeTool) throw new Error('connector_probe tool missing');

    await probeTool.handler({ connectorId: CONNECTOR_ID }, context);

    expect(service.probe).toHaveBeenCalledWith(PROJECT_ID, CONNECTOR_ID, actor, 'mcp', ORG_ID);
  });
});
