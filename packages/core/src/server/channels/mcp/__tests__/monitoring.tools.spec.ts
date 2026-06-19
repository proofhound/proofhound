import { describe, expect, it, vi } from 'vitest';
import type { MonitoringService } from '../../../modules/monitoring/monitoring.service';
import { dispatchTool } from '../mcp-server.factory';
import { createMonitoringTools } from '../monitoring.tools';
import type { McpToolContext } from '../mcp.types';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

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

const FROM = '2026-01-01T00:00:00.000Z';
const TO = '2026-01-02T00:00:00.000Z';

function serviceStub(): MonitoringService {
  return {
    getStats: vi.fn().mockResolvedValue({ requests: {} }),
    getTimeseries: vi.fn().mockResolvedValue({ granularity: 'hour', points: [] }),
    getPromptRanking: vi.fn().mockResolvedValue({ sortBy: 'requests', items: [] }),
    getModelRanking: vi.fn().mockResolvedValue({ sortBy: 'requests', items: [] }),
  } as unknown as MonitoringService;
}

describe('MCP monitoring tools', () => {
  it('exposes the monitoring tool surface 1:1', () => {
    const names = createMonitoringTools(serviceStub()).map((tool) => tool.name);
    expect(names).toEqual([
      'monitoring_get_stats',
      'monitoring_get_timeseries',
      'monitoring_get_prompt_ranking',
      'monitoring_get_model_ranking',
    ]);
  });

  it('monitoring_get_stats: delegates the parsed filter scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createMonitoringTools(service),
      'monitoring_get_stats',
      { from: FROM, to: TO, sources: ['prod'] },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getStats).toHaveBeenCalledTimes(1);
    expect(service.getStats).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ from: FROM, to: TO, sources: ['prod'], granularity: 'auto' }),
      actor,
    );
  });

  it('monitoring_get_stats: missing required time window is a clean tool error, not a throw', async () => {
    const service = serviceStub();
    const result = await dispatchTool(createMonitoringTools(service), 'monitoring_get_stats', { from: FROM }, context);

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.getStats).not.toHaveBeenCalled();
  });

  it('monitoring_get_timeseries: delegates the parsed filter scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createMonitoringTools(service),
      'monitoring_get_timeseries',
      { from: FROM, to: TO, granularity: 'hour' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getTimeseries).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ from: FROM, to: TO, granularity: 'hour' }),
      actor,
    );
  });

  it('monitoring_get_timeseries: non-datetime `to` is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createMonitoringTools(service),
      'monitoring_get_timeseries',
      { from: FROM, to: 'not-a-datetime' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.getTimeseries).not.toHaveBeenCalled();
  });

  it('monitoring_get_prompt_ranking: passes filter + parsed sortBy scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createMonitoringTools(service),
      'monitoring_get_prompt_ranking',
      { from: FROM, to: TO, sortBy: 'cost' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getPromptRanking).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ from: FROM, to: TO }),
      'cost',
      actor,
    );
  });

  it('monitoring_get_prompt_ranking: omitted sortBy defaults to `requests`', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createMonitoringTools(service),
      'monitoring_get_prompt_ranking',
      { from: FROM, to: TO },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getPromptRanking).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ from: FROM, to: TO }),
      'requests',
      actor,
    );
  });

  it('monitoring_get_prompt_ranking: unknown sortBy enum is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createMonitoringTools(service),
      'monitoring_get_prompt_ranking',
      { from: FROM, to: TO, sortBy: 'tokens' },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('invalid tool input');
    expect(service.getPromptRanking).not.toHaveBeenCalled();
  });

  it('monitoring_get_model_ranking: passes filter + parsed sortBy scoped by project + actor', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createMonitoringTools(service),
      'monitoring_get_model_ranking',
      { from: FROM, to: TO, sortBy: 'tokens' },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(service.getModelRanking).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ from: FROM, to: TO }),
      'tokens',
      actor,
    );
  });

  it('monitoring_get_model_ranking: unknown sortBy enum is a clean tool error', async () => {
    const service = serviceStub();
    const result = await dispatchTool(
      createMonitoringTools(service),
      'monitoring_get_model_ranking',
      { from: FROM, to: TO, sortBy: 'failureRate' },
      context,
    );

    expect(result.isError).toBe(true);
    expect(service.getModelRanking).not.toHaveBeenCalled();
  });
});
