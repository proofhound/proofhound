import { describe, expect, it, vi } from 'vitest';
import type { ReleaseLineService } from '../../../modules/release-line/release-line.service';
import { dispatchTool } from '../mcp-server.factory';
import { createReleaseLineTools } from '../release-line.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const RELEASE_LINE_ID = '22222222-2222-4222-8222-222222222222';

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
  project: { projectId: PROJECT_ID, source: 'local' },
};

function serviceStub(): ReleaseLineService {
  return {
    updateInputRoute: vi.fn().mockResolvedValue({ ok: true }),
    updateRunConfig: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as ReleaseLineService;
}

describe('MCP release line tools — shape-sensitive validation', () => {
  it('release_line_update_input_route: production lane + array variableMapping yields a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const tools = createReleaseLineTools(service);

    // production expects an object map; the array form is allowed by the advertised oneOf but rejected
    // by the discriminatedUnion DTO. This must surface as a structured tool error, not an uncaught throw.
    const result = await dispatchTool(
      tools,
      'release_line_update_input_route',
      {
        releaseLineId: RELEASE_LINE_ID,
        laneType: 'production',
        variableMapping: [{ source: 'a', target: 'id' }],
        externalIdField: 'id',
      },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.updateInputRoute).not.toHaveBeenCalled();
  });

  it('release_line_update_input_route: production lane + object variableMapping passes validation and calls the service', async () => {
    const service = serviceStub();
    const tools = createReleaseLineTools(service);

    const result = await dispatchTool(
      tools,
      'release_line_update_input_route',
      {
        releaseLineId: RELEASE_LINE_ID,
        laneType: 'production',
        variableMapping: { question: 'input' },
        externalIdField: 'id',
      },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.updateInputRoute).toHaveBeenCalledTimes(1);
    expect(service.updateInputRoute).toHaveBeenCalledWith(
      PROJECT_ID,
      RELEASE_LINE_ID,
      expect.objectContaining({ laneType: 'production', variableMapping: { question: 'input' } }),
      actor,
    );
  });

  it('release_line_update_run_config: malformed runConfig yields a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const tools = createReleaseLineTools(service);

    const result = await dispatchTool(
      tools,
      'release_line_update_run_config',
      {
        releaseLineId: RELEASE_LINE_ID,
        laneType: 'production',
        // rpmLimit / tpmLimit are required positive integers; this violates the DTO.
        runConfig: { rpmLimit: -1 },
      },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.updateRunConfig).not.toHaveBeenCalled();
  });
});
